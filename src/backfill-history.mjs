#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HEADERS,
  JOB_LOG_FAILURE_SOURCE,
  discoverReports,
  extractRouteResultsFromJobLog,
  readTable,
  updateMetrics,
  writeTable,
} from './metrics-core.mjs';
import { expandWorkflowRunAttempts, isTerminalSource } from './backfill-history-policy.mjs';

const args = parseArgs(process.argv.slice(2));
const repo = required(args, 'repo');
const workflow = required(args, 'workflow');
const since = args.since ?? '1970-01-01';
const until = args.until ?? new Date().toISOString();
const repoRoot = path.resolve(args['repo-root'] ?? process.cwd());
const limit = args.limit ? Number(args.limit) : Infinity;
const retries = Number(args.retries ?? 3);
const quietSkips = Boolean(args['quiet-skips']);
const refresh = Boolean(args.refresh);

const latestRuns = listRuns({ repo, workflow, since, until, limit });
const runs = expandWorkflowRunAttempts(latestRuns, ({ run, attempt }) => {
  try {
    return getWorkflowRunAttempt({ repo, runId: run.databaseId, attempt });
  } catch (error) {
    if (!isGhPermanentUnavailable(error)) {
      throw error;
    }
    console.warn(`Run ${run.databaseId} attempt ${attempt}: metadata is unavailable; skipping that attempt.`);
    return null;
  }
});
console.log(`Found ${latestRuns.length} historical workflow runs with ${runs.length} attempt(s) to inspect.`);
const runSources = seedInspectedRuns({ repoRoot, runs, workflow });

const summary = {
  inspected: 0,
  imported: 0,
  skippedNoArtifact: 0,
  skippedNoReport: 0,
  skippedNoSignal: 0,
  artifactFailures: 0,
  logFailures: 0,
  skippedExisting: 0,
  reports: 0,
  logResults: 0,
};

for (const run of runs) {
  summary.inspected += 1;
  const runKey = getRunKey(run);
  if (!refresh && isTerminalSource(runSources.get(runKey))) {
    summary.skippedExisting += 1;
    continue;
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), `e2e-ci-metrics-${run.databaseId}-`));
  try {
    let imported = false;
    let hasE2eArtifacts = false;

    if (run.isLatestAttempt) {
      try {
        hasE2eArtifacts = hasE2eReportArtifactsForRun({
          repo,
          runId: run.databaseId,
        });
      } catch (error) {
        summary.artifactFailures += 1;
        console.warn(`Run ${run.databaseId}: artifact discovery failed; trying job logs. ${error.message}`);
      }
    }

    if (hasE2eArtifacts) {
      try {
        downloadArtifacts({
          repo,
          runId: run.databaseId,
          outputDir: tempDir,
          retries,
        });
        const reports = discoverReports(tempDir);
        if (reports.length === 0) {
          summary.skippedNoReport += 1;
          logSkip(`Run ${run.databaseId}: E2E artifact existed but no JSON reports were found.`);
        } else {
          updateMetrics({
            repoRoot,
            reports,
            run: buildRunRow(run, workflow, 'artifact_json'),
            artifactUrl: run.url ?? '',
          });
          summary.imported += 1;
          summary.reports += reports.length;
          runSources.set(runKey, 'artifact_json');
          imported = true;
          console.log(`Run ${run.databaseId}: imported ${reports.length} report(s).`);
        }
      } catch (error) {
        summary.artifactFailures += 1;
        console.warn(`Run ${run.databaseId}: artifact import failed; trying job logs. ${error.message}`);
      }
    } else {
      summary.skippedNoArtifact += 1;
      logSkip(
        `Run ${run.databaseId} attempt ${run.attempt}: no attempt-specific E2E JSON artifacts found; trying job logs.`,
      );
    }

    if (imported) {
      continue;
    }

    const logResults = collectLogResults({ repo, run, retries });
    if (logResults.length === 0) {
      summary.skippedNoSignal += 1;
      if (isFailureLikeRun(run)) {
        markRunSource({
          repoRoot,
          run,
          workflow,
          dataSource: 'unavailable_job_log',
        });
        runSources.set(runKey, 'unavailable_job_log');
      }
      logSkip(`Run ${run.databaseId}: no E2E failure summary found in job logs; skipped.`);
      continue;
    }

    updateMetrics({
      repoRoot,
      reports: [],
      results: logResults,
      run: buildRunRow(run, workflow, JOB_LOG_FAILURE_SOURCE),
      artifactUrl: run.url ?? '',
    });
    summary.imported += 1;
    summary.logResults += logResults.length;
    runSources.set(runKey, JOB_LOG_FAILURE_SOURCE);
    console.log(`Run ${run.databaseId}: imported ${logResults.length} log-derived route signal(s).`);
  } catch (error) {
    summary.logFailures += 1;
    if (isFailureLikeRun(run) && isGhPermanentUnavailable(error)) {
      markRunSource({
        repoRoot,
        run,
        workflow,
        dataSource: 'unavailable_job_log',
      });
      runSources.set(runKey, 'unavailable_job_log');
    }
    console.warn(`Run ${run.databaseId}: log import failed; skipped. ${error.message}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

console.log(
  `Backfill summary: inspected=${summary.inspected}, imported=${summary.imported}, reports=${summary.reports}, logResults=${summary.logResults}, skippedExisting=${summary.skippedExisting}, skippedNoArtifact=${summary.skippedNoArtifact}, skippedNoReport=${summary.skippedNoReport}, skippedNoSignal=${summary.skippedNoSignal}, artifactFailures=${summary.artifactFailures}, logFailures=${summary.logFailures}`,
);

function buildRunRow(run, workflow, dataSource) {
  return {
    run_id: String(run.databaseId),
    run_attempt: String(run.attempt ?? 1),
    run_number: String(run.number ?? ''),
    workflow: run.workflowName ?? workflow,
    branch: run.headBranch ?? '',
    sha: run.headSha ?? '',
    event: run.event ?? '',
    pr_number: run.prNumber ?? '',
    started_at: run.startedAt ?? '',
    completed_at: run.updatedAt ?? run.startedAt ?? '',
    conclusion: run.conclusion ?? '',
    data_source: dataSource,
  };
}

function seedInspectedRuns({ repoRoot, runs, workflow }) {
  const runsPath = path.join(repoRoot, 'data', 'runs.csv');
  const existing = readTable(runsPath, HEADERS.runs);
  const byKey = new Map(existing.map((row) => [`${row.run_id}#${row.run_attempt || '1'}`, row]));

  for (const run of runs) {
    const row = buildRunRow(run, workflow, 'inspected_ci');
    byKey.set(`${row.run_id}#${row.run_attempt}`, {
      ...row,
      data_source: byKey.get(`${row.run_id}#${row.run_attempt}`)?.data_source || row.data_source,
    });
  }

  writeTable(
    runsPath,
    HEADERS.runs,
    [...byKey.values()].sort((left, right) => (left.completed_at || '').localeCompare(right.completed_at || '')),
  );
  console.log(`Seeded ${runs.length} inspected workflow run row(s).`);
  return new Map([...byKey.entries()].map(([key, row]) => [key, row.data_source]));
}

function markRunSource({ repoRoot, run, workflow, dataSource }) {
  const runsPath = path.join(repoRoot, 'data', 'runs.csv');
  const existing = readTable(runsPath, HEADERS.runs);
  const row = buildRunRow(run, workflow, dataSource);
  const byKey = new Map(
    existing.map((candidate) => [`${candidate.run_id}#${candidate.run_attempt || '1'}`, candidate]),
  );
  byKey.set(`${row.run_id}#${row.run_attempt}`, row);
  writeTable(
    runsPath,
    HEADERS.runs,
    [...byKey.values()].sort((left, right) => (left.completed_at || '').localeCompare(right.completed_at || '')),
  );
}

function getRunKey(run) {
  return `${run.databaseId}#${run.attempt ?? 1}`;
}

function isFailureLikeRun(run) {
  return ['failure', 'timed_out', 'cancelled'].includes(String(run.conclusion ?? '').toLowerCase());
}

function collectLogResults({ repo, run, retries }) {
  if (!isFailureLikeRun(run)) {
    return [];
  }

  const jobs = listE2eTestJobs({
    repo,
    runId: run.databaseId,
    attempt: run.attempt,
  });
  const results = [];
  for (const job of jobs) {
    const conclusion = String(job.conclusion ?? '').toLowerCase();
    if (!['failure', 'timed_out', 'cancelled'].includes(conclusion)) {
      continue;
    }

    try {
      const logText = downloadJobLog({ repo, jobId: job.databaseId, retries });
      const jobResults = extractRouteResultsFromJobLog(logText, {
        platform: job.platform,
        artifactUrl: job.url,
      });
      results.push(...jobResults);
      if (jobResults.length > 0) {
        console.log(`Run ${run.databaseId} ${job.name}: recovered ${jobResults.length} route signal(s) from log.`);
      }
    } catch (error) {
      console.warn(`Run ${run.databaseId} ${job.name}: could not recover log signals. ${error.message}`);
    }
  }

  return results;
}

function listE2eTestJobs({ repo, runId, attempt }) {
  const jobs = [];
  let page = 1;

  while (true) {
    const response = ghApiJson(
      `repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs`,
      {
        per_page: '100',
        page: String(page),
      },
      '{jobs: [.jobs[] | {id, name, conclusion, html_url}]}',
    );
    const pageJobs = response.jobs ?? [];
    if (pageJobs.length === 0) {
      break;
    }
    for (const job of pageJobs) {
      const platform = inferPlatformFromJobName(job.name);
      if (!platform) {
        continue;
      }
      jobs.push({
        databaseId: job.id,
        name: job.name,
        conclusion: job.conclusion,
        url: job.html_url,
        platform,
      });
    }
    page += 1;
  }

  return jobs;
}

function inferPlatformFromJobName(name) {
  const lower = String(name ?? '').toLowerCase();
  if (!lower.includes('test suite / test')) {
    return '';
  }
  if (lower.includes('macos') || lower.includes('mac os') || lower.includes('darwin')) {
    return 'macos';
  }
  if (lower.includes('windows') || lower.includes('win32')) {
    return 'windows';
  }
  return '';
}

function downloadJobLog({ repo, jobId, retries }) {
  const buffer = withRetries(
    () =>
      execFileSync('gh', ['api', '-X', 'GET', `repos/${repo}/actions/jobs/${jobId}/logs`], {
        encoding: 'buffer',
        maxBuffer: 128 * 1024 * 1024,
      }),
    retries,
    `download job log ${jobId}`,
  );
  return decodeLogBuffer(buffer);
}

function decodeLogBuffer(buffer) {
  const utf8 = buffer.toString('utf8');
  if (utf8.includes('\u0000')) {
    return buffer.toString('utf16le');
  }
  return utf8;
}

function listRuns({ repo, workflow, since, until, limit }) {
  const workflowId = resolveWorkflowId({ repo, workflow });
  const ranges = Number.isFinite(limit)
    ? [{ start: normalizeStart(since), end: normalizeEnd(until) }]
    : splitCreatedRanges({
        repo,
        workflowId,
        start: normalizeStart(since),
        end: normalizeEnd(until),
      });
  const runsById = new Map();

  console.log(
    `Backfill query: repo:${repo} workflow:${workflow} created:${formatRange({ start: normalizeStart(since), end: normalizeEnd(until) })}`,
  );
  console.log(`Backfill range slices: ${ranges.length}`);
  for (const range of ranges) {
    const pageRuns = listRunsInRange({
      repo,
      workflowId,
      range,
      remaining: limit - runsById.size,
    });

    for (const run of pageRuns) {
      runsById.set(String(run.databaseId), run);
      if (runsById.size >= limit) {
        break;
      }
    }
    if (runsById.size >= limit) {
      break;
    }
  }

  return [...runsById.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

function resolveWorkflowId({ repo, workflow }) {
  if (/^\d+$/.test(workflow)) {
    return workflow;
  }

  const response = ghApiJson(`repos/${repo}/actions/workflows`, {
    per_page: '100',
  });
  const workflows = response.workflows ?? [];
  const matched = workflows.find((candidate) => {
    const pathName = path.posix.basename(candidate.path ?? '');
    return (
      candidate.id === Number(workflow) ||
      candidate.name === workflow ||
      candidate.path === workflow ||
      pathName === workflow
    );
  });

  if (!matched) {
    throw new Error(`Workflow not found: ${workflow}`);
  }
  return String(matched.id);
}

function normalizeWorkflowRun(run) {
  return {
    databaseId: run.id,
    attempt: run.run_attempt,
    number: run.run_number,
    workflowName: run.name,
    headBranch: run.head_branch,
    headSha: run.head_sha,
    event: run.event,
    startedAt: run.run_started_at ?? run.created_at,
    updatedAt: run.updated_at,
    conclusion: run.conclusion,
    url: run.html_url,
    prNumber: run.pull_requests?.[0]?.number ?? '',
  };
}

function getWorkflowRunAttempt({ repo, runId, attempt }) {
  const run = ghApiJson(`repos/${repo}/actions/runs/${runId}/attempts/${attempt}`);
  return normalizeWorkflowRun(run);
}

function splitCreatedRanges({ repo, workflowId, start, end }) {
  const count = countRunsInRange({ repo, workflowId, range: { start, end } });
  if (count < 1000) {
    return [{ start, end }];
  }

  const startMs = start.getTime();
  const endMs = end.getTime();
  const durationMs = endMs - startMs;
  if (durationMs <= 24 * 60 * 60 * 1000) {
    console.warn(
      `Created range ${formatRange({ start, end })} still has ${count} runs; GitHub may cap this slice at 1000.`,
    );
    return [{ start, end }];
  }

  const middle = new Date(startMs + Math.floor(durationMs / 2));
  const rightStart = new Date(middle.getTime() + 1);
  return [
    ...splitCreatedRanges({ repo, workflowId, start, end: middle }),
    ...splitCreatedRanges({ repo, workflowId, start: rightStart, end }),
  ];
}

function countRunsInRange({ repo, workflowId, range }) {
  const response = ghApiJson(
    `repos/${repo}/actions/workflows/${workflowId}/runs`,
    {
      status: 'completed',
      created: formatRange(range),
      per_page: '1',
      page: '1',
    },
    '{total_count}',
  );
  return Number(response.total_count ?? 0);
}

function listRunsInRange({ repo, workflowId, range, remaining }) {
  const runs = [];
  let page = 1;
  while (runs.length < remaining) {
    const response = ghApiJson(
      `repos/${repo}/actions/workflows/${workflowId}/runs`,
      {
        status: 'completed',
        created: formatRange(range),
        per_page: '100',
        page: String(page),
      },
      '{total_count, workflow_runs: [.workflow_runs[] | {id, run_attempt, run_number, name, head_branch, head_sha, event, run_started_at, created_at, updated_at, conclusion, html_url, pull_requests}]}',
    );
    const pageRuns = response.workflow_runs ?? [];
    if (pageRuns.length === 0) {
      break;
    }
    for (const run of pageRuns) {
      runs.push(normalizeWorkflowRun(run));
      if (runs.length >= remaining) {
        break;
      }
    }
    page += 1;
  }
  return runs;
}

function formatRange({ start, end }) {
  return `${start.toISOString()}..${end.toISOString()}`;
}

function normalizeStart(value) {
  return new Date(value);
}

function normalizeEnd(value) {
  return new Date(value);
}

function hasE2eReportArtifactsForRun({ repo, runId }) {
  let page = 1;

  while (true) {
    const response = ghApiJson(
      `repos/${repo}/actions/runs/${runId}/artifacts`,
      {
        per_page: '100',
        page: String(page),
      },
      '{artifacts: [.artifacts[] | {name, expired}]}',
    );
    const artifacts = response.artifacts ?? [];
    if (artifacts.length === 0) {
      return false;
    }

    for (const artifact of artifacts) {
      if (String(artifact.name ?? '').startsWith('e2e-report-') && !artifact.expired) {
        return true;
      }
    }
    page += 1;
  }
}

function downloadArtifacts({ repo, runId, outputDir, retries }) {
  try {
    withRetries(
      () =>
        execFileSync(
          'gh',
          ['run', 'download', String(runId), '--repo', repo, '--pattern', 'e2e-report-*', '--dir', outputDir],
          {
            stdio: 'inherit',
          },
        ),
      retries,
      `download artifacts for run ${runId}`,
    );
  } catch {
    const entries = readdirSync(outputDir);
    if (entries.length === 0) {
      return;
    }
    throw new Error(`artifact download failed for run ${runId}`);
  }
}

function ghApiJson(endpoint, fields = {}, jq = '') {
  return withRetries(
    () => {
      const ghArgs = ['api', '-X', 'GET', endpoint];
      for (const [key, value] of Object.entries(fields)) {
        ghArgs.push('-f', `${key}=${value}`);
      }
      if (jq) {
        ghArgs.push('--jq', jq);
      }
      const output = execFileSync('gh', ghArgs, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      return JSON.parse(output);
    },
    retries,
    `GitHub API ${endpoint}`,
    { retryPermanentUnavailable: true },
  );
}

function withRetries(operation, retries, label, { retryPermanentUnavailable = false } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= Math.max(1, retries); attempt += 1) {
    try {
      return operation();
    } catch (error) {
      lastError = error;
      if (isGhPermanentUnavailable(error) && !retryPermanentUnavailable) {
        throw error;
      }
      if (attempt < retries) {
        console.warn(`${label}: attempt ${attempt} failed; retrying. ${error.message}`);
      }
    }
  }
  throw lastError;
}

function isGhPermanentUnavailable(error) {
  const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf8') : String(error?.stderr ?? '');
  return /HTTP (404|410)/.test(`${error?.message ?? ''}\n${stderr}`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = !next || next.startsWith('--') ? true : next;
    if (parsed[key] !== true) {
      index += 1;
    }
  }
  return parsed;
}

function required(parsedArgs, key) {
  const value = parsedArgs[key];
  if (!value || value === true) {
    throw new Error(`Missing required --${key}`);
  }
  return value;
}

function logSkip(message) {
  if (!quietSkips) {
    console.warn(message);
  }
}
