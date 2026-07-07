import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
  ],
  routeResults: [
    'run_id',
    'run_attempt',
    'platform',
    'project',
    'route_id',
    'outcome',
    'duration_ms',
    'retry_count',
    'attempt_failures',
    'error_signature',
    'artifact_url',
  ],
  routeStats: [
    'route_id',
    'module_tags',
    'total_runs',
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
  overrides: ['route_id', 'module_tags', 'note'],
};

const FAILED_ATTEMPT_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

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

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((value) => value !== ''));
}

export function stringifyCsv(headers, rows) {
  const lines = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvField(row[header] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function readTable(filePath, headers) {
  if (!existsSync(filePath)) {
    return [];
  }

  const parsed = parseCsv(readFileSync(filePath, 'utf8'));
  if (parsed.length === 0) {
    return [];
  }

  const [actualHeaders, ...records] = parsed;
  const effectiveHeaders = actualHeaders.length > 0 ? actualHeaders : headers;
  return records.map((record) => {
    const row = {};
    effectiveHeaders.forEach((header, index) => {
      row[header] = record[index] ?? '';
    });
    for (const header of headers) {
      row[header] ??= '';
    }
    return row;
  });
}

export function writeTable(filePath, headers, rows) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const sortedRows = [...rows];
  writeFileSync(filePath, stringifyCsv(headers, sortedRows), 'utf8');
}

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
        });
      }
    });
  }

  return results;
}

export function updateMetrics({ repoRoot, reports, run, artifactUrl = '' }) {
  ensureTables(repoRoot);

  const overrides = loadOverrides(repoRoot);
  const extractedResults = reports.flatMap((report) =>
    extractRouteResultsFromReport(report.path, {
      platform: report.platform,
      artifactUrl: report.artifactUrl ?? artifactUrl,
    }),
  );

  const runKey = getRunKey(run);
  const runRow = normalizeRun(run);

  const runsPath = path.join(repoRoot, 'data', 'runs.csv');
  const routeResultsPath = path.join(repoRoot, 'data', 'route_results.csv');
  const routesPath = path.join(repoRoot, 'data', 'routes.csv');
  const routeStatsPath = path.join(repoRoot, 'data', 'route_stats.csv');

  const existingRuns = readTable(runsPath, HEADERS.runs).filter((row) => getRunKey(row) !== runKey);
  const runs = [...existingRuns, runRow].sort(compareRunRows);

  const existingResults = readTable(routeResultsPath, HEADERS.routeResults).filter(
    (row) => getRunKey(row) !== runKey,
  );
  const routeResults = [
    ...existingResults,
    ...extractedResults.map((result) => ({
      run_id: runRow.run_id,
      run_attempt: runRow.run_attempt,
      platform: result.platform,
      project: result.project,
      route_id: result.route_id,
      outcome: result.outcome,
      duration_ms: result.duration_ms,
      retry_count: result.retry_count,
      attempt_failures: result.attempt_failures,
      error_signature: result.error_signature,
      artifact_url: result.artifact_url,
    })),
  ].sort(compareRouteResultRows);

  const routes = mergeRoutes({
    existingRoutes: readTable(routesPath, HEADERS.routes),
    extractedResults,
    completedAt: runRow.completed_at,
    overrides,
  });
  const stats = computeRouteStats({ routes, routeResults, runs });

  writeTable(runsPath, HEADERS.runs, runs);
  writeTable(routeResultsPath, HEADERS.routeResults, routeResults);
  writeTable(routesPath, HEADERS.routes, routes);
  writeTable(routeStatsPath, HEADERS.routeStats, stats);

  return {
    routesUpdated: extractedResults.length,
    reportsRead: reports.length,
  };
}

export function updateMetricsWithGit({ repoRoot, reports, run, artifactUrl, commitMessage, push, pushRetries }) {
  const attempts = Math.max(1, Number(pushRetries || 1));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (push && attempt > 1) {
        git(repoRoot, ['fetch', 'origin', 'main']);
        git(repoRoot, ['reset', '--hard', 'origin/main']);
      }

      const summary = updateMetrics({ repoRoot, reports, run, artifactUrl });
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
    ['data/route_results.csv', HEADERS.routeResults],
    ['data/route_stats.csv', HEADERS.routeStats],
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

function normalizeErrorSignature(message) {
  return String(message)
    .split('\n')[0]
    .replace(/\s+/g, ' ')
    .replace(/[A-Z]:\\[^\s)]+/g, '<path>')
    .replace(/\/[^ \t:)]+/g, '<path>')
    .slice(0, 240);
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

function computeRouteStats({ routes, routeResults, runs }) {
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
    const nonSkipped = results.filter((result) => result.outcome !== 'skipped');
    const failed = results.filter((result) => result.outcome === 'failed');
    const flaky = results.filter((result) => result.outcome === 'flaky');
    const latest = [...results].sort((a, b) => compareResultByRunTime(a, b, runByKey)).at(-1);
    const latestFailed = [...failed].sort((a, b) => compareResultByRunTime(a, b, runByKey)).at(-1);
    const totalRuns = nonSkipped.length;

    stats.push({
      route_id: routeId,
      module_tags: routeById.get(routeId)?.module_tags ?? '',
      total_runs: String(totalRuns),
      failed_runs: String(failed.length),
      flaky_runs: String(flaky.length),
      attempt_failures: String(sum(results.map((result) => Number(result.attempt_failures || 0)))),
      pass_rate: totalRuns === 0 ? '' : ((totalRuns - failed.length) / totalRuns).toFixed(4),
      failed_runs_macos: String(failed.filter((result) => result.platform === 'macos').length),
      failed_runs_windows: String(failed.filter((result) => result.platform === 'windows').length),
      last_outcome: latest?.outcome ?? '',
      last_failed_at: latestFailed ? (runByKey.get(getRunKey(latestFailed))?.completed_at ?? '') : '',
      top_error_signature: topErrorSignature(results),
    });
  }

  return stats.sort((a, b) => a.route_id.localeCompare(b.route_id));
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

function escapeCsvField(value) {
  const stringValue = String(value ?? '');
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
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
