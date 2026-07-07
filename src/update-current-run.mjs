#!/usr/bin/env node
import path from 'node:path';
import { discoverReports, updateMetrics, updateMetricsWithGit } from './metrics-core.mjs';

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(args['repo-root'] ?? process.cwd());
const reports = collectReports(args);

if (reports.length === 0) {
  console.warn('No Playwright JSON reports found; metrics update skipped.');
  process.exit(0);
}

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

const commitMessage =
  args['commit-message'] ??
  `metrics: update aoe-desktop ci run ${run.run_id} attempt ${run.run_attempt}`;

const summary =
  args.commit || args.push
    ? updateMetricsWithGit({
        repoRoot,
        reports,
        run,
        artifactUrl: args['artifact-url'] ?? '',
        commitMessage,
        push: Boolean(args.push),
        pushRetries: Number(args['push-retries'] ?? 1),
      })
    : updateMetrics({
        repoRoot,
        reports,
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
