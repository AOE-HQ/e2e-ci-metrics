import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseCsv, readTable, stringifyCsv, writeTable } from './csv-table.mjs';
import {
  ROUTE_RESULT_HEADERS,
  ensureRouteResultsSharded,
  readRouteResults,
  routeResultDay,
  writeRouteResults,
} from './route-results-store.mjs';

export { parseCsv, readTable, stringifyCsv, writeTable } from './csv-table.mjs';

export const HEADERS = {
  routes: [
    'route_id',
    'spec_file',
    'spec_basename',
    'title_path',
    'module_tags',
    'first_seen_at',
    'last_seen_at',
    'status',
  ],
  runs: [
    'run_id',
    'run_attempt',
    'run_number',
    'workflow',
    'branch',
    'sha',
    'event',
    'pr_number',
    'started_at',
    'completed_at',
    'conclusion',
    'data_source',
  ],
  routeResults: ROUTE_RESULT_HEADERS,
  routeStats: [
    'route_id',
    'module_tags',
    'total_runs',
    'full_runs',
    'full_failed_runs',
    'full_flaky_runs',
    'log_signal_runs',
    'log_failed_runs',
    'log_flaky_runs',
    'failed_runs',
    'flaky_runs',
    'attempt_failures',
    'pass_rate',
    'failed_runs_macos',
    'failed_runs_windows',
    'last_outcome',
    'last_failed_at',
    'top_error_signature',
  ],
  routePlatformStats: [
    'route_id',
    'platform',
    'module_tags',
    'total_runs',
    'full_runs',
    'full_failed_runs',
    'full_flaky_runs',
    'log_signal_runs',
    'log_failed_runs',
    'log_flaky_runs',
    'failed_runs',
    'flaky_runs',
    'attempt_failures',
    'pass_rate',
    'last_outcome',
    'last_failed_at',
    'top_error_signature',
  ],
  overrides: ['route_id', 'module_tags', 'note'],
};

const FAILED_ATTEMPT_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);
export const ARTIFACT_JSON_SOURCE = 'artifact_json';
export const JOB_LOG_FAILURE_SOURCE = 'job_log_failure_summary';
export const JOB_LOG_ROUTE_METRIC_SOURCE = 'job_log_route_metric';
const JOB_LOG_ROUTE_METRIC_PREFIX = 'E2E_ROUTE_METRIC';

const MODULE_TAG_RULES = [
  ['automation', ['automation-*', 'floatboat-calendar-*', 'task-copy-*']],
  ['calendar', ['calendar-*', 'ics-subscription-*']],
  [
    'chat',
    [
      'chat.spec.ts',
      'chat-*',
      'agent-message-*',
      'agent-untyped-*',
      'completion-notification-*',
      'context-compaction-*',
      'context-menu-*',
      'dislike-dialog-*',
      'gpt54-*',
      'hidden-auto-*',
      'legacy-auto-*',
      'newapi-*',
      'stop-button-*',
      'tool-call-*',
    ],
  ],
  [
    'agent-runtime',
    [
      'agent-auto-*',
      'agent-context-*',
      'claude-*',
      'floatboat-duplicate-*',
      'floatboat-manual-*',
      'floatboat-runtime-*',
      'floatboat-tool-*',
      'restart-auto-resume-*',
      'runtime-*',
    ],
  ],
  ['agent-im', ['agent-im-*']],
  ['browser', ['browser-*', 'user-menu-browser-*']],
  ['combo', ['combo-*', 'skill-import-combo-*']],
  ['skill-multi-source', ['skill-multi-source*', 'skills-install-*']],
  ['custom-command', ['custom-command*']],
  [
    'file-browser',
    [
      'file-browser.spec.ts',
      'file-browser-*',
      'file-manager-*',
      'folder-rename-*',
      'drag-drop*',
      'triple-click-*',
      'windows-my-documents-*',
    ],
  ],
  ['file-preview', ['file-preview-*', 'preview*', 'markdown-*', 'xlsx-preview-*']],
  ['file-search', ['file-search-*']],
  ['focus-management', ['focus-*']],
  ['git', ['git-*']],
  ['i18n', ['i18n-*']],
  ['keyboard-shortcuts', ['keyboard-*', 'key-journeys*', 'panel-shortcuts*']],
  ['memo', ['memo-*']],
  ['model-selector', ['model-selector-*']],
  ['navigation', ['navigation*', 'sidebar-*', 'titlebar-*', 'user-menu-links-*']],
  ['network', ['network-*']],
  ['notifications', ['notification-*', 'session-completion-notification-*']],
  ['onboarding', ['first-run-*', 'new-session-onboarding*', 'welcome-*']],
  ['payments', ['payment-*']],
  ['permissions', ['permission-*', 'prompt-leak-*']],
  ['recording', ['recording-*', 'tutorial-*']],
  ['session', ['session.spec.ts', 'session-*', 'restart-auto-resume-*']],
  ['settings', ['settings.spec.ts', 'settings-*', 'local-claude-config-*']],
  ['support', ['support-*']],
  ['workspace', ['workspace.spec.ts', 'workspace-*', 'persist-temp-workspace-*']],
  [
    'app-shell',
    [
      'app-launch*',
      'auth*',
      'advanced-journeys*',
      'background-process-startup-diagnostics-*',
      'journeys*',
      'main-thread-*',
      'performance*',
      'visual*',
      'windows-main-window-*',
      'force-update-*',
    ],
  ],
  ['tools', ['tools*']],
];

export function discoverReports(reportsDir) {
  if (!reportsDir || !existsSync(reportsDir)) {
    return [];
  }

  const reports = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const fullPath = path.join(directory, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith('.json')) {
        reports.push({ platform: inferPlatformFromPath(fullPath), path: fullPath });
      }
    }
  };

  walk(reportsDir);
  return reports.filter((report) => report.platform);
}

export function normalizeSpecFile(specFile) {
  return String(specFile ?? '').replace(/\\/g, '/');
}

export function buildRouteId(specFile, titlePath) {
  return `${normalizeSpecFile(specFile)} :: ${titlePath}`;
}

export function inferModuleTags(specBasename, titlePath = '') {
  const normalized = specBasename.toLowerCase();
  const tags = new Set();

  for (const [tag, patterns] of MODULE_TAG_RULES) {
    if (patterns.some((pattern) => matchesGlob(normalized, pattern))) {
      tags.add(tag);
    }
  }

  const lowerTitle = titlePath.toLowerCase();
  if (lowerTitle.includes('browser') || lowerTitle.includes('webcontentsview')) {
    tags.add('browser');
  }
  if (lowerTitle.includes('calendar') || lowerTitle.includes('schedule')) {
    tags.add('calendar');
  }
  if (lowerTitle.includes('automation')) {
    tags.add('automation');
  }

  return [...tags].sort();
}

export function loadOverrides(repoRoot) {
  const filePath = path.join(repoRoot, 'config', 'route-module-overrides.csv');
  const rows = readTable(filePath, HEADERS.overrides);
  const overrides = new Map();
  for (const row of rows) {
    if (row.route_id && row.module_tags) {
      overrides.set(row.route_id, row.module_tags);
    }
  }
  return overrides;
}

export function extractRouteResultsFromReport(reportPath, { platform, artifactUrl = '' } = {}) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const projectNamesById = new Map();
  for (const project of report.config?.projects ?? []) {
    if (project.id) {
      projectNamesById.set(project.id, project.name);
    }
  }

  const results = [];
  for (const suite of report.suites ?? []) {
    walkSuite(suite, [], null, (spec, titleSegments, inheritedFile) => {
      const specFile = normalizeSpecFile(spec.file ?? inheritedFile ?? '');
      const titlePath = [...titleSegments, spec.title].filter(Boolean).join(' > ');
      const routeId = buildRouteId(specFile, titlePath);

      for (const test of spec.tests ?? []) {
        const project = test.projectName ?? projectNamesById.get(test.projectId) ?? test.projectId ?? '';
        if (project !== 'electron') {
          continue;
        }

        const attemptSummary = summarizeAttempts(test);
        results.push({
          platform,
          project,
          route_id: routeId,
          spec_file: specFile,
          spec_basename: path.posix.basename(specFile),
          title_path: titlePath,
          outcome: attemptSummary.outcome,
          duration_ms: String(attemptSummary.durationMs),
          retry_count: String(attemptSummary.retryCount),
          attempt_failures: String(attemptSummary.attemptFailures),
          error_signature: attemptSummary.errorSignature,
          artifact_url: artifactUrl,
          data_source: ARTIFACT_JSON_SOURCE,
        });
      }
    });
  }

  return results;
}

export function extractRouteResultsFromJobLog(logText, { platform, artifactUrl = '' } = {}) {
  const lines = String(logText ?? '')
    .replace(/\x1B\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map(normalizeGithubLogLine);
  const routeMetricResults = extractRouteMetricResultsFromLines(lines, { platform, artifactUrl });
  if (routeMetricResults.length > 0) {
    return routeMetricResults;
  }

  const listReporterResults = extractListReporterResultsFromLines(lines, { platform, artifactUrl });
  if (listReporterResults.length > 0) {
    return listReporterResults;
  }

  const detailErrors = collectJobLogErrorSignatures(lines);
  const results = [];
  const seen = new Set();
  let currentOutcome = '';
  let remaining = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const summary = trimmed.match(/^(\d+)\s+(failed|flaky)\b/i);
    if (summary) {
      currentOutcome = summary[2].toLowerCase() === 'failed' ? 'failed' : 'flaky';
      remaining = Number(summary[1]);
      continue;
    }

    if (/^\d+\s+(passed|skipped|did not run|interrupted|timed out)\b/i.test(trimmed)) {
      currentOutcome = '';
      remaining = 0;
      continue;
    }

    if (!currentOutcome || remaining <= 0) {
      continue;
    }

    const parsed = parsePlaywrightTestLine(line);
    if (!parsed || parsed.project !== 'electron') {
      continue;
    }

    const routeId = buildRouteId(parsed.specFile, parsed.titlePath);
    const dedupeKey = `${platform}\0${currentOutcome}\0${routeId}`;
    if (seen.has(dedupeKey)) {
      remaining -= 1;
      continue;
    }
    seen.add(dedupeKey);

    results.push({
      platform,
      project: parsed.project,
      route_id: routeId,
      spec_file: parsed.specFile,
      spec_basename: path.posix.basename(parsed.specFile),
      title_path: parsed.titlePath,
      outcome: currentOutcome,
      duration_ms: '',
      retry_count: currentOutcome === 'flaky' ? '1' : '0',
      attempt_failures: '1',
      error_signature: detailErrors.get(routeId) ?? '',
      artifact_url: artifactUrl,
      data_source: JOB_LOG_FAILURE_SOURCE,
    });

    remaining -= 1;
    if (remaining <= 0) {
      currentOutcome = '';
    }
  }

  return results;
}

function extractListReporterResultsFromLines(lines, { platform, artifactUrl }) {
  const attemptsByRoute = new Map();
  let lastElectronAttemptIndex = -1;

  for (const [index, line] of lines.entries()) {
    const attempt = parseListReporterAttemptLine(line);
    if (!attempt || attempt.project !== 'electron') {
      continue;
    }

    const routeId = buildRouteId(attempt.specFile, attempt.titlePath);
    const entry = attemptsByRoute.get(routeId) ?? {
      routeId,
      specFile: attempt.specFile,
      titlePath: attempt.titlePath,
      attempts: [],
    };
    entry.attempts.push(attempt);
    attemptsByRoute.set(routeId, entry);
    lastElectronAttemptIndex = index;
  }

  if (attemptsByRoute.size === 0) {
    return [];
  }

  const summaries = [...attemptsByRoute.values()].map(summarizeListReporterAttempts);
  if (!listReporterFooterMatches(lines, lastElectronAttemptIndex, summaries)) {
    return [];
  }

  const detailErrors = collectJobLogErrorSignatures(lines);
  return summaries.map((summary) => ({
    platform,
    project: 'electron',
    route_id: summary.routeId,
    spec_file: summary.specFile,
    spec_basename: path.posix.basename(summary.specFile),
    title_path: summary.titlePath,
    outcome: summary.outcome,
    duration_ms: summary.durationMs === null ? '' : String(summary.durationMs),
    retry_count: String(summary.retryCount),
    attempt_failures: String(summary.attemptFailures),
    error_signature: detailErrors.get(summary.routeId) ?? '',
    artifact_url: artifactUrl,
    data_source: JOB_LOG_ROUTE_METRIC_SOURCE,
  }));
}

function parseListReporterAttemptLine(line) {
  const match = String(line ?? '').match(
    /^\s*(✓|✘|×|ok|x|-)\s+\d+\s+\[([^\]]+)\]\s+›\s+(.+?\.spec\.ts):\d+:\d+\s+›\s+(.+?)\s*$/,
  );
  if (!match) {
    return null;
  }

  let title = match[4].trim();
  const durationMatch = title.match(/\s+\((\d+(?:\.\d+)?)\s*(ms|s|m|h)\)$/i);
  const durationMs = durationMatch ? durationToMilliseconds(durationMatch[1], durationMatch[2]) : null;
  if (durationMatch) {
    title = title.slice(0, durationMatch.index).trim();
  }

  const retryMatch = title.match(/\s+\(retry #(\d+)\)$/i);
  const retryNumber = retryMatch ? Number(retryMatch[1]) : 0;
  if (retryMatch) {
    title = title.slice(0, retryMatch.index).trim();
  }

  const marker = match[1].toLowerCase();
  let status = 'failed';
  if (marker === '✓' || marker === 'ok') {
    status = 'passed';
  } else if (marker === '-') {
    status = 'skipped';
  }

  return {
    project: match[2],
    specFile: path.posix.basename(normalizeSpecFile(match[3])),
    titlePath: title
      .split(/\s+›\s+/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join(' > '),
    status,
    retryNumber,
    durationMs,
  };
}

function summarizeListReporterAttempts(entry) {
  const attemptFailures = entry.attempts.filter((attempt) => attempt.status === 'failed').length;
  const lastAttempt = entry.attempts.at(-1);
  let outcome = lastAttempt?.status ?? 'failed';
  if (lastAttempt?.status === 'passed' && attemptFailures > 0) {
    outcome = 'flaky';
  }

  const durations = entry.attempts.map((attempt) => attempt.durationMs).filter((value) => value !== null);
  const durationMs = durations.length > 0 ? sum(durations) : null;
  const retryCount = Math.max(
    entry.attempts.length - 1,
    ...entry.attempts.map((attempt) => attempt.retryNumber),
  );

  return {
    ...entry,
    outcome,
    durationMs,
    retryCount,
    attemptFailures,
  };
}

function listReporterFooterMatches(lines, lastElectronAttemptIndex, summaries) {
  const expected = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const summary of summaries) {
    expected[summary.outcome] += 1;
  }

  const actual = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
  let sawSummary = false;

  for (let index = lastElectronAttemptIndex + 1; index < lines.length; index += 1) {
    const nextAttempt = parseListReporterAttemptLine(lines[index]);
    if (nextAttempt && nextAttempt.project !== 'electron') {
      break;
    }

    const match = lines[index].trim().match(/^(\d+)\s+(passed|failed|flaky|skipped|did not run)\b/i);
    if (!match) {
      continue;
    }
    const key = match[2].toLowerCase();
    if (key === 'did not run') {
      actual.skipped += Number(match[1]);
    } else {
      actual[key] = Number(match[1]);
    }
    sawSummary = true;
  }

  return (
    sawSummary &&
    actual.passed === expected.passed &&
    actual.failed === expected.failed &&
    actual.flaky === expected.flaky &&
    actual.skipped === expected.skipped
  );
}

function durationToMilliseconds(value, unit) {
  const amount = Number(value);
  if (unit.toLowerCase() === 'h') {
    return Math.round(amount * 60 * 60 * 1000);
  }
  if (unit.toLowerCase() === 'm') {
    return Math.round(amount * 60 * 1000);
  }
  if (unit.toLowerCase() === 's') {
    return Math.round(amount * 1000);
  }
  return Math.round(amount);
}

function extractRouteMetricResultsFromLines(lines, { platform, artifactUrl }) {
  const resultsByRoute = new Map();
  let lastMetricIndex = -1;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(`${JOB_LOG_ROUTE_METRIC_PREFIX} `)) {
      continue;
    }

    const payloadText = trimmed.slice(JOB_LOG_ROUTE_METRIC_PREFIX.length).trim();
    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      continue;
    }
    if (!payload || typeof payload !== 'object') {
      continue;
    }

    const result = normalizeExtractedResult({
      ...payload,
      platform: payload.platform ?? platform,
      artifact_url: payload.artifact_url ?? artifactUrl,
      data_source: JOB_LOG_ROUTE_METRIC_SOURCE,
    });

    if (!result.platform || result.project !== 'electron' || !result.route_id || !result.spec_file || !result.title_path) {
      continue;
    }
    if (!['passed', 'failed', 'flaky', 'skipped'].includes(result.outcome)) {
      continue;
    }

    const dedupeKey = `${result.platform}\0${result.project}\0${result.route_id}`;
    resultsByRoute.set(dedupeKey, {
      ...result,
      error_signature: result.error_signature ? normalizeErrorSignature(result.error_signature) : '',
    });
    lastMetricIndex = index;
  }

  const results = [...resultsByRoute.values()];
  return results.length > 0 && listReporterFooterMatches(lines, lastMetricIndex, results) ? results : [];
}

export function updateMetrics({ repoRoot, reports = [], results = [], run, artifactUrl = '' }) {
  return updateMetricsBatch({
    repoRoot,
    updates: [{ reports, results, run, artifactUrl }],
  });
}

export function updateMetricsBatch({ repoRoot, updates = [], recomputeAggregates = true }) {
  ensureTables(repoRoot);

  const overrides = loadOverrides(repoRoot);
  const runsPath = path.join(repoRoot, 'data', 'runs.csv');
  const routesPath = path.join(repoRoot, 'data', 'routes.csv');
  const routeStatsPath = path.join(repoRoot, 'data', 'route_stats.csv');
  const routePlatformStatsPath = path.join(repoRoot, 'data', 'route_platform_stats.csv');

  let runs = readTable(runsPath, HEADERS.runs);
  ensureRouteResultsSharded({ repoRoot, runs });
  const existingRunsByKey = new Map(runs.map((run) => [getRunKey(run), run]));
  const affectedDays = new Set();
  for (const update of updates) {
    const existingRun = existingRunsByKey.get(getRunKey(update.run));
    if (existingRun) {
      affectedDays.add(routeResultDay(existingRun));
    }
    affectedDays.add(routeResultDay(normalizeRun({ ...existingRun, ...update.run })));
  }
  let routeResults = readRouteResults({ repoRoot, days: affectedDays });
  let routes = readTable(routesPath, HEADERS.routes);
  let routesUpdated = 0;
  let reportsRead = 0;

  for (const update of updates) {
    const reports = update.reports ?? [];
    const results = update.results ?? [];
    const artifactUrl = update.artifactUrl ?? '';
    const extractedResults = [
      ...reports.flatMap((report) =>
        extractRouteResultsFromReport(report.path, {
          platform: report.platform,
          artifactUrl: report.artifactUrl ?? artifactUrl,
        }),
      ),
      ...results.map(normalizeExtractedResult),
    ];
    const baseRunRow = normalizeRun({ ...update.run, data_source: '' });
    const runKey = getRunKey(baseRunRow);
    const existingRun = runs.find((row) => getRunKey(row) === runKey);
    const existingRunResults = routeResults.filter((row) => getRunKey(row) === runKey);
    const incomingByPlatform = groupResultsByPlatform(extractedResults);
    const existingByPlatform = groupResultsByPlatform(existingRunResults);
    const replacePlatforms = new Set();

    for (const [platform, incomingPlatformResults] of incomingByPlatform) {
      const incomingPriority = platformResultPriority(incomingPlatformResults);
      const existingPriority = platformResultPriority(existingByPlatform.get(platform) ?? []);
      if (incomingPriority >= existingPriority) {
        replacePlatforms.add(platform);
      }
    }

    const acceptedResults = extractedResults.filter((result) => replacePlatforms.has(result.platform));
    routeResults = [
      ...routeResults.filter((row) => getRunKey(row) !== runKey),
      ...existingRunResults.filter((row) => !replacePlatforms.has(row.platform)),
      ...acceptedResults.map((result) => ({
        run_id: baseRunRow.run_id,
        run_attempt: baseRunRow.run_attempt,
        platform: result.platform,
        project: result.project,
        route_id: result.route_id,
        outcome: result.outcome,
        duration_ms: result.duration_ms,
        retry_count: result.retry_count,
        attempt_failures: result.attempt_failures,
        error_signature: result.error_signature,
        artifact_url: result.artifact_url,
        data_source: result.data_source,
      })),
    ];
    const mergedRunResults = routeResults.filter((row) => getRunKey(row) === runKey);
    const runRow = normalizeRun({
      ...existingRun,
      ...update.run,
      pr_number: update.run.pr_number || update.run.prNumber || existingRun?.pr_number || '',
      data_source:
        summarizeDataSources(mergedRunResults) || update.run.data_source || existingRun?.data_source || '',
    });
    runs = [...runs.filter((row) => getRunKey(row) !== runKey), runRow];
    routes = mergeRoutes({
      existingRoutes: routes,
      extractedResults,
      completedAt: runRow.completed_at,
      overrides,
    });
    routesUpdated += extractedResults.length;
    reportsRead += reports.length;
  }

  runs.sort(compareRunRows);
  routeResults.sort(compareRouteResultRows);

  writeTable(runsPath, HEADERS.runs, runs);
  const routeResultFilesWritten = writeRouteResults({
    repoRoot,
    rows: routeResults,
    runs,
    days: affectedDays,
  });
  writeTable(routesPath, HEADERS.routes, routes);
  if (recomputeAggregates) {
    const allRouteResults = readRouteResults({ repoRoot });
    const stats = computeRouteStats({ routes, routeResults: allRouteResults, runs });
    const platformStats = computeRoutePlatformStats({ routes, routeResults: allRouteResults, runs });
    writeTable(routeStatsPath, HEADERS.routeStats, stats);
    writeTable(routePlatformStatsPath, HEADERS.routePlatformStats, platformStats);
  }

  return {
    routesUpdated,
    reportsRead,
    routeResultFilesWritten,
  };
}

export function recomputeAggregateTables({ repoRoot }) {
  ensureTables(repoRoot);

  const runsPath = path.join(repoRoot, 'data', 'runs.csv');
  const routesPath = path.join(repoRoot, 'data', 'routes.csv');
  const routeStatsPath = path.join(repoRoot, 'data', 'route_stats.csv');
  const routePlatformStatsPath = path.join(repoRoot, 'data', 'route_platform_stats.csv');

  const runs = readTable(runsPath, HEADERS.runs);
  const routeResults = readRouteResults({ repoRoot });
  const routes = readTable(routesPath, HEADERS.routes);

  writeTable(routeStatsPath, HEADERS.routeStats, computeRouteStats({ routes, routeResults, runs }));
  writeTable(
    routePlatformStatsPath,
    HEADERS.routePlatformStats,
    computeRoutePlatformStats({ routes, routeResults, runs }),
  );
}

export function updateMetricsWithGit({ repoRoot, reports, results, run, artifactUrl, commitMessage, push, pushRetries }) {
  const attempts = Math.max(1, Number(pushRetries || 1));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (push && attempt > 1) {
        git(repoRoot, ['fetch', 'origin', 'main']);
        git(repoRoot, ['reset', '--hard', 'origin/main']);
      }

      const summary = updateMetrics({ repoRoot, reports, results, run, artifactUrl });
      git(repoRoot, ['add', 'data', 'config']);

      if (gitQuiet(repoRoot, ['diff', '--cached', '--quiet'])) {
        return { ...summary, committed: false, pushed: false };
      }

      git(repoRoot, ['commit', '-m', commitMessage]);
      if (!push) {
        return { ...summary, committed: true, pushed: false };
      }

      const pushed = spawnSync('git', ['push', 'origin', 'HEAD:main'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'inherit',
      });
      if (pushed.status === 0) {
        return { ...summary, committed: true, pushed: true };
      }

      lastError = new Error(`git push failed on attempt ${attempt}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('metrics update failed');
}

function ensureTables(repoRoot) {
  const files = [
    ['data/routes.csv', HEADERS.routes],
    ['data/runs.csv', HEADERS.runs],
    ['data/route_stats.csv', HEADERS.routeStats],
    ['data/route_platform_stats.csv', HEADERS.routePlatformStats],
    ['config/route-module-overrides.csv', HEADERS.overrides],
  ];

  for (const [file, headers] of files) {
    const filePath = path.join(repoRoot, file);
    if (!existsSync(filePath)) {
      writeTable(filePath, headers, []);
    }
  }
}

function walkSuite(suite, parentTitles, inheritedFile, onSpec) {
  const suiteFile = suite.file ?? inheritedFile;
  const suiteTitle = normalizeSuiteTitle(suite.title, suiteFile);
  const titleSegments = suiteTitle ? [...parentTitles, suiteTitle] : parentTitles;

  for (const child of suite.suites ?? []) {
    walkSuite(child, titleSegments, suiteFile, onSpec);
  }

  for (const spec of suite.specs ?? []) {
    onSpec(spec, titleSegments, suiteFile);
  }
}

function summarizeAttempts(test) {
  const results = test.results ?? [];
  const retryCount = results.reduce((max, result, index) => Math.max(max, Number(result.retry ?? index)), 0);
  const attemptFailures = results.filter((result) => FAILED_ATTEMPT_STATUSES.has(result.status)).length;
  const finalResult = results[results.length - 1];
  const durationMs = results.reduce((sum, result) => sum + Number(result.duration ?? 0), 0);
  const errorSignature = firstErrorSignature(results);

  let outcome = 'failed';
  if (test.status === 'skipped' || finalResult?.status === 'skipped') {
    outcome = 'skipped';
  } else if (test.status === 'flaky' || (attemptFailures > 0 && finalResult?.status === 'passed')) {
    outcome = 'flaky';
  } else if (test.status === 'expected' || finalResult?.status === 'passed') {
    outcome = 'passed';
  }

  return { outcome, durationMs, retryCount, attemptFailures, errorSignature };
}

function firstErrorSignature(results) {
  for (const result of results) {
    for (const error of result.errors ?? []) {
      const message = error.message ?? error.stack ?? error.value ?? '';
      if (message) {
        return normalizeErrorSignature(message);
      }
    }
    if (result.error?.message) {
      return normalizeErrorSignature(result.error.message);
    }
  }
  return '';
}

export function normalizeErrorSignature(message) {
  return String(message)
    .split('\n')[0]
    .replace(/\x1B\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[A-Z]:\\[^\s)]+/g, '<path>')
    .replace(/\/[^ \t:)]+/g, '<path>')
    .slice(0, 240);
}

function collectJobLogErrorSignatures(lines) {
  const errors = new Map();
  let currentRouteId = '';

  for (const line of lines) {
    const parsed = parsePlaywrightTestLine(line);
    if (/^\s*\d+\)\s+\[/.test(line) && parsed?.project === 'electron') {
      currentRouteId = buildRouteId(parsed.specFile, parsed.titlePath);
      continue;
    }

    const trimmed = line.trim();
    if (!currentRouteId) {
      continue;
    }
    if (/^\d+\)\s+\[/.test(trimmed) || /^\d+\s+(failed|flaky|passed|skipped|did not run)\b/i.test(trimmed)) {
      currentRouteId = '';
      continue;
    }
    if (errors.has(currentRouteId)) {
      continue;
    }

    const signature = extractJobLogErrorSignature(trimmed);
    if (signature) {
      errors.set(currentRouteId, signature);
    }
  }

  return errors;
}

function extractJobLogErrorSignature(line) {
  if (!line) {
    return '';
  }

  if (
    /^(Error|TimeoutError|AssertionError|TypeError|ReferenceError|SyntaxError|RangeError):\s*/.test(line) ||
    /^expect\(.+\)\./.test(line)
  ) {
    return normalizeErrorSignature(line);
  }

  return '';
}

function parsePlaywrightTestLine(line) {
  const match = line.match(/^\s*(?:\d+\)\s*)?\[([^\]]+)\]\s+›\s+(.+?\.spec\.ts):\d+:\d+\s+›\s+(.+?)\s*$/);
  if (!match) {
    return null;
  }

  const specFile = path.posix.basename(normalizeSpecFile(match[2]));
  return {
    project: match[1],
    specFile,
    titlePath: match[3]
      .split(/\s+›\s+/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join(' > '),
  };
}

function normalizeGithubLogLine(line) {
  return String(line ?? '').replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s?/, '');
}

function normalizeExtractedResult(result) {
  const specFile = normalizeSpecFile(result.spec_file ?? result.specFile ?? '');
  const titlePath = String(result.title_path ?? result.titlePath ?? '');
  return {
    platform: String(result.platform ?? ''),
    project: String(result.project ?? 'electron'),
    route_id: String(result.route_id ?? result.routeId ?? buildRouteId(specFile, titlePath)),
    spec_file: specFile,
    spec_basename: String(result.spec_basename ?? result.specBasename ?? path.posix.basename(specFile)),
    title_path: titlePath,
    outcome: String(result.outcome ?? ''),
    duration_ms: String(result.duration_ms ?? result.durationMs ?? ''),
    retry_count: String(result.retry_count ?? result.retryCount ?? ''),
    attempt_failures: String(result.attempt_failures ?? result.attemptFailures ?? ''),
    error_signature: String(result.error_signature ?? result.errorSignature ?? ''),
    artifact_url: String(result.artifact_url ?? result.artifactUrl ?? ''),
    data_source: String(result.data_source ?? result.dataSource ?? ARTIFACT_JSON_SOURCE),
  };
}

function summarizeDataSources(results) {
  const sources = [...new Set(results.map((result) => result.data_source).filter(Boolean))].sort();
  return sources.join(';');
}

function groupResultsByPlatform(results) {
  const grouped = new Map();
  for (const result of results) {
    const platform = String(result.platform ?? '');
    if (!platform) {
      continue;
    }
    if (!grouped.has(platform)) {
      grouped.set(platform, []);
    }
    grouped.get(platform).push(result);
  }
  return grouped;
}

function platformResultPriority(results) {
  return results.reduce((priority, result) => {
    if (result.data_source === JOB_LOG_ROUTE_METRIC_SOURCE) {
      return Math.max(priority, 2);
    }
    if (result.data_source === JOB_LOG_FAILURE_SOURCE) {
      return Math.max(priority, 1);
    }
    return priority;
  }, 0);
}

function mergeRoutes({ existingRoutes, extractedResults, completedAt, overrides }) {
  const routes = new Map(existingRoutes.map((row) => [row.route_id, { ...row }]));

  for (const result of extractedResults) {
    const existing = routes.get(result.route_id);
    const inferredTags = inferModuleTags(result.spec_basename, result.title_path).join(';');
    const moduleTags = overrides.get(result.route_id) ?? inferredTags;

    routes.set(result.route_id, {
      route_id: result.route_id,
      spec_file: result.spec_file,
      spec_basename: result.spec_basename,
      title_path: result.title_path,
      module_tags: moduleTags,
      first_seen_at: minTimestamp(existing?.first_seen_at, completedAt),
      last_seen_at: maxTimestamp(existing?.last_seen_at, completedAt),
      status: 'active',
    });
  }

  return [...routes.values()].sort((a, b) => a.route_id.localeCompare(b.route_id));
}

export function computeWindowedMetrics({ routes, routeResults, runs, asOf, windows }) {
  const asOfTime = new Date(asOf).getTime();
  if (!Number.isFinite(asOfTime)) {
    throw new Error(`Invalid metrics window asOf timestamp: ${asOf}`);
  }

  const runTimeByKey = new Map(
    runs.map((run) => [getRunKey(run), new Date(run.completed_at).getTime()]),
  );
  const output = {};

  for (const window of windows) {
    const key = String(window.key ?? '');
    const durationMs = Number(window.durationMs);
    if (!key || !Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error(`Invalid metrics window definition: ${JSON.stringify(window)}`);
    }
    if (output[key]) {
      throw new Error(`Duplicate metrics window key: ${key}`);
    }

    const sinceTime = asOfTime - durationMs;
    const windowRuns = runs.filter((run) => {
      const completedAt = runTimeByKey.get(getRunKey(run));
      return Number.isFinite(completedAt) && completedAt >= sinceTime && completedAt <= asOfTime;
    });
    const runKeys = new Set(windowRuns.map(getRunKey));
    const windowResults = routeResults.filter((result) => runKeys.has(getRunKey(result)));

    output[key] = {
      since: new Date(sinceTime).toISOString(),
      routeStats: computeRouteStats({ routes, routeResults: windowResults, runs: windowRuns }),
      routePlatformStats: computeRoutePlatformStats({
        routes,
        routeResults: windowResults,
        runs: windowRuns,
      }),
    };
  }

  return { asOf: new Date(asOfTime).toISOString(), windows: output };
}

export function computeRouteStats({ routes, routeResults, runs }) {
  const routeById = new Map(routes.map((route) => [route.route_id, route]));
  const runByKey = new Map(runs.map((run) => [getRunKey(run), run]));
  const grouped = new Map();

  for (const result of routeResults) {
    if (!grouped.has(result.route_id)) {
      grouped.set(result.route_id, []);
    }
    grouped.get(result.route_id).push(result);
  }

  const stats = [];
  for (const [routeId, results] of grouped) {
    const metricResults = results.filter(isLogSignal);
    if (metricResults.length === 0) {
      continue;
    }
    const nonSkipped = metricResults.filter((result) => result.outcome !== 'skipped');
    const fullNonSkipped = nonSkipped.filter(isFullObservation);
    const logSignals = nonSkipped;
    const failed = metricResults.filter((result) => result.outcome === 'failed');
    const flaky = metricResults.filter((result) => result.outcome === 'flaky');
    const fullFailed = fullNonSkipped.filter((result) => result.outcome === 'failed');
    const fullFlaky = fullNonSkipped.filter((result) => result.outcome === 'flaky');
    const logFailed = logSignals.filter((result) => result.outcome === 'failed');
    const logFlaky = logSignals.filter((result) => result.outcome === 'flaky');
    const latest = [...metricResults].sort((a, b) => compareResultByRunTime(a, b, runByKey)).at(-1);
    const latestFailed = [...failed].sort((a, b) => compareResultByRunTime(a, b, runByKey)).at(-1);
    const totalRuns = nonSkipped.length;
    const fullRuns = fullNonSkipped.length;

    stats.push({
      route_id: routeId,
      module_tags: routeById.get(routeId)?.module_tags ?? '',
      total_runs: String(totalRuns),
      full_runs: String(fullRuns),
      full_failed_runs: String(fullFailed.length),
      full_flaky_runs: String(fullFlaky.length),
      log_signal_runs: String(logSignals.length),
      log_failed_runs: String(logFailed.length),
      log_flaky_runs: String(logFlaky.length),
      failed_runs: String(failed.length),
      flaky_runs: String(flaky.length),
      attempt_failures: String(sum(metricResults.map((result) => Number(result.attempt_failures || 0)))),
      pass_rate:
        fullRuns === 0 ? '' : ((fullRuns - fullFailed.length - fullFlaky.length) / fullRuns).toFixed(4),
      failed_runs_macos: String(failed.filter((result) => result.platform === 'macos').length),
      failed_runs_windows: String(failed.filter((result) => result.platform === 'windows').length),
      last_outcome: latest?.outcome ?? '',
      last_failed_at: latestFailed ? (runByKey.get(getRunKey(latestFailed))?.completed_at ?? '') : '',
      top_error_signature: topErrorSignature(metricResults),
    });
  }

  return stats.sort((a, b) => a.route_id.localeCompare(b.route_id));
}

export function computeRoutePlatformStats({ routes, routeResults, runs }) {
  const routeById = new Map(routes.map((route) => [route.route_id, route]));
  const runByKey = new Map(runs.map((run) => [getRunKey(run), run]));
  const grouped = new Map();

  for (const result of routeResults) {
    const groupKey = `${result.route_id}\0${result.platform}`;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }
    grouped.get(groupKey).push(result);
  }

  const stats = [];
  for (const results of grouped.values()) {
    const routeId = results[0]?.route_id ?? '';
    const platform = results[0]?.platform ?? '';
    const metricResults = results.filter(isLogSignal);
    if (metricResults.length === 0) {
      continue;
    }
    const nonSkipped = metricResults.filter((result) => result.outcome !== 'skipped');
    const fullNonSkipped = nonSkipped.filter(isFullObservation);
    const logSignals = nonSkipped;
    const failed = metricResults.filter((result) => result.outcome === 'failed');
    const flaky = metricResults.filter((result) => result.outcome === 'flaky');
    const fullFailed = fullNonSkipped.filter((result) => result.outcome === 'failed');
    const fullFlaky = fullNonSkipped.filter((result) => result.outcome === 'flaky');
    const logFailed = logSignals.filter((result) => result.outcome === 'failed');
    const logFlaky = logSignals.filter((result) => result.outcome === 'flaky');
    const latest = [...metricResults].sort((a, b) => compareResultByRunTime(a, b, runByKey)).at(-1);
    const latestFailed = [...failed].sort((a, b) => compareResultByRunTime(a, b, runByKey)).at(-1);
    const totalRuns = nonSkipped.length;
    const fullRuns = fullNonSkipped.length;

    stats.push({
      route_id: routeId,
      platform,
      module_tags: routeById.get(routeId)?.module_tags ?? '',
      total_runs: String(totalRuns),
      full_runs: String(fullRuns),
      full_failed_runs: String(fullFailed.length),
      full_flaky_runs: String(fullFlaky.length),
      log_signal_runs: String(logSignals.length),
      log_failed_runs: String(logFailed.length),
      log_flaky_runs: String(logFlaky.length),
      failed_runs: String(failed.length),
      flaky_runs: String(flaky.length),
      attempt_failures: String(sum(metricResults.map((result) => Number(result.attempt_failures || 0)))),
      pass_rate:
        fullRuns === 0 ? '' : ((fullRuns - fullFailed.length - fullFlaky.length) / fullRuns).toFixed(4),
      last_outcome: latest?.outcome ?? '',
      last_failed_at: latestFailed ? (runByKey.get(getRunKey(latestFailed))?.completed_at ?? '') : '',
      top_error_signature: topErrorSignature(metricResults),
    });
  }

  return stats.sort((a, b) => a.route_id.localeCompare(b.route_id) || a.platform.localeCompare(b.platform));
}

function isFullObservation(result) {
  const source = result.data_source || ARTIFACT_JSON_SOURCE;
  return source === JOB_LOG_ROUTE_METRIC_SOURCE;
}

function isLogSignal(result) {
  return result.data_source === JOB_LOG_ROUTE_METRIC_SOURCE || result.data_source === JOB_LOG_FAILURE_SOURCE;
}

function normalizeRun(run) {
  return {
    run_id: String(run.run_id ?? run.runId ?? ''),
    run_attempt: String(run.run_attempt ?? run.runAttempt ?? '1'),
    run_number: String(run.run_number ?? run.runNumber ?? ''),
    workflow: String(run.workflow ?? ''),
    branch: String(run.branch ?? ''),
    sha: String(run.sha ?? ''),
    event: String(run.event ?? ''),
    pr_number: String(run.pr_number ?? run.prNumber ?? ''),
    started_at: String(run.started_at ?? run.startedAt ?? ''),
    completed_at: String(run.completed_at ?? run.completedAt ?? new Date().toISOString()),
    conclusion: String(run.conclusion ?? ''),
    data_source: String(run.data_source ?? run.dataSource ?? ''),
  };
}

function compareRunRows(a, b) {
  return (a.completed_at || '').localeCompare(b.completed_at || '') || getRunKey(a).localeCompare(getRunKey(b));
}

function compareRouteResultRows(a, b) {
  return (
    getRunKey(a).localeCompare(getRunKey(b)) ||
    a.platform.localeCompare(b.platform) ||
    a.route_id.localeCompare(b.route_id)
  );
}

function compareResultByRunTime(a, b, runByKey) {
  const aRun = runByKey.get(getRunKey(a));
  const bRun = runByKey.get(getRunKey(b));
  return (aRun?.completed_at ?? '').localeCompare(bRun?.completed_at ?? '') || getRunKey(a).localeCompare(getRunKey(b));
}

function topErrorSignature(results) {
  const counts = new Map();
  for (const result of results) {
    if (!result.error_signature) {
      continue;
    }
    counts.set(result.error_signature, (counts.get(result.error_signature) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
}

function normalizeSuiteTitle(title, suiteFile) {
  const value = String(title ?? '').trim();
  if (!value) {
    return '';
  }
  const normalizedFile = normalizeSpecFile(suiteFile ?? '');
  const normalizedTitle = normalizeSpecFile(value);
  if (normalizedFile && (normalizedTitle === normalizedFile || normalizedTitle.endsWith(path.posix.basename(normalizedFile)))) {
    return '';
  }
  if (normalizedTitle.endsWith('.spec.ts')) {
    return '';
  }
  return value;
}

function inferPlatformFromPath(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.includes('macos') || lower.includes('darwin')) {
    return 'macos';
  }
  if (lower.includes('windows') || lower.includes('win32')) {
    return 'windows';
  }
  return '';
}

function matchesGlob(value, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(value);
}

function getRunKey(row) {
  return `${row.run_id ?? ''}#${row.run_attempt ?? '1'}`;
}

function minTimestamp(a, b) {
  if (!a) {
    return b ?? '';
  }
  if (!b) {
    return a;
  }
  return a.localeCompare(b) <= 0 ? a : b;
}

function maxTimestamp(a, b) {
  if (!a) {
    return b ?? '';
  }
  if (!b) {
    return a;
  }
  return a.localeCompare(b) >= 0 ? a : b;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function git(repoRoot, args) {
  execFileSync('git', args, { cwd: repoRoot, stdio: 'inherit' });
}

function gitQuiet(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, stdio: 'ignore' });
  return result.status === 0;
}
