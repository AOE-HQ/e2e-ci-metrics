#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  discoverReports,
  extractRouteResultsFromJobLog,
  updateMetrics,
  updateMetricsWithGit,
} from './metrics-core.mjs';

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(args['repo-root'] ?? process.cwd());
const reports = collectReports(args);

const run = {
  run_id: required(args, 'run-id'),
  run_attempt: args['run-attempt'] ?? '1',
  run_number: args['run-number'] ?? '',
  workflow: args.workflow ?? '',
  branch: args.branch ?? '',
  sha: args.sha ?? '',
  event: args.event ?? '',
  pr_number: args['pr-number'] ?? '',
  started_at: args['started-at'] ?? '',
  completed_at: args['completed-at'] ?? new Date().toISOString(),
  conclusion: args.conclusion ?? '',
};

let logResults = [];
if (!args['no-collect-job-logs']) {
  try {
    logResults = collectCurrentRunLogResults({
      repo: args['github-repo'] ?? process.env.GITHUB_REPOSITORY,
      runId: run.run_id,
      retries: Number(args['log-retries'] ?? 3),
    });
  } catch (error) {
    console.warn(`Could not collect current-run job log outcomes; downloaded reports will be used for route discovery only. ${error.message}`);
  }
}

const effectiveReports = logResults.length > 0 ? [] : reports;
if (effectiveReports.length === 0 && logResults.length === 0) {
  console.warn('No E2E job-log metrics or Playwright JSON reports found; metrics update skipped.');
  process.exit(0);
}

const commitMessage =
  args['commit-message'] ??
  `metrics: update aoe-desktop ci run ${run.run_id} attempt ${run.run_attempt}`;

const summary =
  args.commit || args.push
    ? updateMetricsWithGit({
        repoRoot,
        reports: effectiveReports,
        results: logResults,
        run,
        artifactUrl: args['artifact-url'] ?? '',
        commitMessage,
        push: Boolean(args.push),
        pushRetries: Number(args['push-retries'] ?? 1),
      })
    : updateMetrics({
        repoRoot,
        reports: effectiveReports,
        results: logResults,
        run,
        artifactUrl: args['artifact-url'] ?? '',
      });

console.log(
  `Updated E2E metrics: reports=${summary.reportsRead}, routeResults=${summary.routesUpdated}, committed=${summary.committed ?? false}, pushed=${summary.pushed ?? false}`,
);

function collectReports(parsedArgs) {
  const reports = [];
  for (const report of arrayArg(parsedArgs.report)) {
    const separator = report.indexOf('=');
    if (separator === -1) {
      reports.push({ platform: inferPlatform(report), path: path.resolve(report) });
    } else {
      reports.push({
        platform: report.slice(0, separator),
        path: path.resolve(report.slice(separator + 1)),
      });
    }
  }

  for (const reportsDir of arrayArg(parsedArgs['reports-dir'])) {
    reports.push(...discoverReports(path.resolve(reportsDir)));
  }

  return reports.filter((report) => report.platform && report.path);
}

function collectCurrentRunLogResults({ repo, runId, retries }) {
  if (!repo) {
    throw new Error('Missing --github-repo or GITHUB_REPOSITORY for job log collection.');
  }

  const jobs = listE2eTestJobs({ repo, runId });
  const results = [];

  for (const job of jobs) {
    try {
      const logText = downloadJobLog({ repo, jobId: job.databaseId, retries });
      const jobResults = extractRouteResultsFromJobLog(logText, {
        platform: job.platform,
        artifactUrl: job.url,
      });
      results.push(...jobResults);
      console.log(`Current run ${job.name}: imported ${jobResults.length} route metric row(s) from job log.`);
    } catch (error) {
      console.warn(`Current run ${job.name}: could not import job log metrics. ${error.message}`);
    }
  }

  return results;
}

function listE2eTestJobs({ repo, runId }) {
  try {
    const jobs = listE2eTestJobsWithApi({ repo, runId });
    if (jobs.length > 0) {
      return jobs;
    }
  } catch (error) {
    console.warn(`Could not list jobs through the Actions jobs API; trying gh run view. ${error.message}`);
  }
  return listE2eTestJobsWithRunView({ repo, runId });
}

function listE2eTestJobsWithApi({ repo, runId }) {
  const jobs = [];
  let page = 1;

  while (true) {
    const response = ghApiJson(
      `repos/${repo}/actions/runs/${runId}/jobs`,
      {
        filter: 'latest',
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

function listE2eTestJobsWithRunView({ repo, runId }) {
  const output = execFileSync('gh', ['run', 'view', String(runId), '--repo', repo, '--json', 'jobs'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const response = JSON.parse(output);
  return (response.jobs ?? [])
    .map((job) => ({
      databaseId: job.databaseId ?? job.id,
      name: job.name,
      conclusion: job.conclusion,
      url: job.url ?? '',
      platform: inferPlatformFromJobName(job.name),
    }))
    .filter((job) => job.databaseId && job.platform);
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
  const attempts = Math.max(1, retries);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(`${label}: attempt ${attempt} failed; retrying. ${error.message}`);
      }
    }
  }
  throw lastError;
}

function inferPlatform(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.includes('macos') || lower.includes('darwin')) {
    return 'macos';
  }
  if (lower.includes('windows') || lower.includes('win32')) {
    return 'windows';
  }
  return '';
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
    const value = !next || next.startsWith('--') ? true : next;
    if (value !== true) {
      index += 1;
    }
    if (parsed[key] === undefined) {
      parsed[key] = value;
    } else if (Array.isArray(parsed[key])) {
      parsed[key].push(value);
    } else {
      parsed[key] = [parsed[key], value];
    }
  }
  return parsed;
}

function arrayArg(value) {
  if (value === undefined || value === true) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function required(parsedArgs, key) {
  const value = parsedArgs[key];
  if (!value || value === true) {
    throw new Error(`Missing required --${key}`);
  }
  return value;
}
