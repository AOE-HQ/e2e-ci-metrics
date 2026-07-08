#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverReports, updateMetrics } from './metrics-core.mjs';

const args = parseArgs(process.argv.slice(2));
const repo = required(args, 'repo');
const workflow = required(args, 'workflow');
const since = args.since ?? '1970-01-01';
const until = args.until ?? new Date().toISOString();
const repoRoot = path.resolve(args['repo-root'] ?? process.cwd());
const limit = args.limit ? Number(args.limit) : Infinity;
const retries = Number(args.retries ?? 3);
const quietSkips = Boolean(args['quiet-skips']);

const runs = listRuns({ repo, workflow, since, until, limit });
const e2eArtifactRunIds = listE2eArtifactRunIds({ repo, since, until });
console.log(`Found ${runs.length} historical workflow runs to inspect.`);
console.log(`Found ${e2eArtifactRunIds.size} workflow runs with E2E JSON artifacts.`);

const summary = {
  inspected: 0,
  imported: 0,
  skippedNoArtifact: 0,
  skippedNoReport: 0,
  artifactFailures: 0,
  reports: 0,
};

for (const run of runs) {
  summary.inspected += 1;
  const tempDir = mkdtempSync(path.join(os.tmpdir(), `e2e-ci-metrics-${run.databaseId}-`));
  try {
    if (!e2eArtifactRunIds.has(String(run.databaseId))) {
      summary.skippedNoArtifact += 1;
      logSkip(`Run ${run.databaseId}: no E2E JSON artifacts found; skipped.`);
      continue;
    }

    downloadArtifacts({ repo, runId: run.databaseId, outputDir: tempDir, retries });
    const reports = discoverReports(tempDir);
    if (reports.length === 0) {
      summary.skippedNoReport += 1;
      logSkip(`Run ${run.databaseId}: no E2E JSON artifacts found; skipped.`);
      continue;
    }

    updateMetrics({
      repoRoot,
      reports,
      run: {
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
      },
      artifactUrl: run.url ?? '',
    });
    summary.imported += 1;
    summary.reports += reports.length;
    console.log(`Run ${run.databaseId}: imported ${reports.length} report(s).`);
  } catch (error) {
    summary.artifactFailures += 1;
    console.warn(`Run ${run.databaseId}: artifact import failed; skipped. ${error.message}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

console.log(
  `Backfill summary: inspected=${summary.inspected}, imported=${summary.imported}, reports=${summary.reports}, skippedNoArtifact=${summary.skippedNoArtifact}, skippedNoReport=${summary.skippedNoReport}, artifactFailures=${summary.artifactFailures}`,
);

function listRuns({ repo, workflow, since, until, limit }) {
  const workflowId = resolveWorkflowId({ repo, workflow });
  const ranges = Number.isFinite(limit)
    ? [{ start: normalizeStart(since), end: normalizeEnd(until) }]
    : splitCreatedRanges({ repo, workflowId, start: normalizeStart(since), end: normalizeEnd(until) });
  const runsById = new Map();

  console.log(`Backfill query: repo:${repo} workflow:${workflow} created:${formatRange({ start: normalizeStart(since), end: normalizeEnd(until) })}`);
  console.log(`Backfill range slices: ${ranges.length}`);
  for (const range of ranges) {
    const pageRuns = listRunsInRange({ repo, workflowId, range, remaining: limit - runsById.size });

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

  const response = ghApiJson(`repos/${repo}/actions/workflows`, { per_page: '100' });
  const workflows = response.workflows ?? [];
  const matched = workflows.find((candidate) => {
    const pathName = path.posix.basename(candidate.path ?? '');
    return candidate.id === Number(workflow) || candidate.name === workflow || candidate.path === workflow || pathName === workflow;
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

function splitCreatedRanges({ repo, workflowId, start, end }) {
  const count = countRunsInRange({ repo, workflowId, range: { start, end } });
  if (count < 1000) {
    return [{ start, end }];
  }

  const startMs = start.getTime();
  const endMs = end.getTime();
  const durationMs = endMs - startMs;
  if (durationMs <= 24 * 60 * 60 * 1000) {
    console.warn(`Created range ${formatRange({ start, end })} still has ${count} runs; GitHub may cap this slice at 1000.`);
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

function listE2eArtifactRunIds({ repo, since, until }) {
  const runIds = new Set();
  let page = 1;

  while (true) {
    const response = ghApiJson(
      `repos/${repo}/actions/artifacts`,
      {
        per_page: '100',
        page: String(page),
      },
      '{artifacts: [.artifacts[] | {name, expired, created_at, workflow_run}]}',
    );
    const artifacts = response.artifacts ?? [];
    if (artifacts.length === 0) {
      break;
    }

    for (const artifact of artifacts) {
      if (!String(artifact.name ?? '').startsWith('e2e-report-')) {
        continue;
      }
      if (artifact.expired) {
        continue;
      }
      if (!isWithinRange(artifact.created_at, since, until)) {
        continue;
      }
      const runId = artifact.workflow_run?.id;
      if (runId) {
        runIds.add(String(runId));
      }
    }
    page += 1;
  }

  return runIds;
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
  const ghArgs = ['api', '-X', 'GET', endpoint];
  for (const [key, value] of Object.entries(fields)) {
    ghArgs.push('-f', `${key}=${value}`);
  }
  if (jq) {
    ghArgs.push('--jq', jq);
  }
  const output = execFileSync('gh', ghArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(output);
}

function withRetries(operation, retries, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= Math.max(1, retries); attempt += 1) {
    try {
      return operation();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        console.warn(`${label}: attempt ${attempt} failed; retrying. ${error.message}`);
      }
    }
  }
  throw lastError;
}

function isWithinRange(timestamp, since, until) {
  if (!timestamp) {
    return true;
  }
  const value = new Date(timestamp).getTime();
  const start = new Date(since).getTime();
  const end = until ? new Date(until).getTime() : Infinity;
  return value >= start && value <= end;
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
