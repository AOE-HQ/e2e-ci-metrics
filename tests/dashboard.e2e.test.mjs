import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { HEADERS } from '../src/metrics-core.mjs';
import { writeRouteResults } from '../src/route-results-store.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'e2e-ci-metrics-dashboard-'));
const fixtureAsOf = '2026-07-10T12:00:00.000Z';
let browser;
let browserServer;
let baseUrl;
let server;

before(async () => {
  writeDashboardFixture(fixtureRoot);
  execFileSync(process.execPath, [path.join(projectRoot, 'src', 'build-pages.mjs')], {
    cwd: fixtureRoot,
    env: { ...process.env, METRICS_AS_OF: fixtureAsOf },
    stdio: 'pipe',
  });
  server = createStaticServer(path.join(fixtureRoot, 'dist'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  browserServer = await launchBrowserServer();
  browser = await chromium.connect(browserServer.wsEndpoint());
});

after(async () => {
  await browserServer?.kill();
  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
});

afterEach(async () => {
  const pages = browser?.contexts().flatMap((context) => context.pages()) ?? [];
  await Promise.all(pages.map((page) => page.close({ runBeforeUnload: false })));
});

test('dashboard build anchors rolling windows to its generated timestamp', () => {
  const manifest = JSON.parse(readFileSync(path.join(fixtureRoot, 'dist', 'manifest.json'), 'utf8'));
  const windowStats = JSON.parse(readFileSync(path.join(fixtureRoot, 'dist', 'data', 'window_stats.json'), 'utf8'));

  assert.equal(manifest.generated_at, fixtureAsOf);
  assert.equal(manifest.time_windows.as_of, fixtureAsOf);
  assert.equal(manifest.time_windows.data_file, 'data/window_stats.json');
  assert.equal(windowStats.asOf, fixtureAsOf);
  assert.deepEqual(
    Object.fromEntries(Object.entries(windowStats.windows).map(([key, value]) => [key, value.since])),
    {
      '30d': '2026-06-10T12:00:00.000Z',
      '7d': '2026-07-03T12:00:00.000Z',
      '1d': '2026-07-09T12:00:00.000Z',
    },
  );
});

test('dashboard publishes a daily route-results index from the results navigation link', async () => {
  const page = await browser.newPage();
  await page.goto(baseUrl);

  const resultsLink = page.getByRole('link', { name: 'results', exact: true });
  assert.equal(await resultsLink.getAttribute('href'), 'data/route_results/index.json');

  const index = JSON.parse(
    readFileSync(path.join(fixtureRoot, 'dist', 'data', 'route_results', 'index.json'), 'utf8'),
  );
  assert.equal(index.schema_version, 1);
  assert.deepEqual(
    index.files.map((file) => file.date),
    ['2026-05-31', '2026-06-25', '2026-07-07', '2026-07-09'],
  );
});

test('dashboard uses consistent outcome colors and honest module bars', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.querySelector('#metric-runs')?.textContent === '4');

  const latestSuccess = page.locator('#latest-run .status');
  assert.equal(await latestSuccess.textContent(), 'success');
  assert.equal(await latestSuccess.evaluate((element) => getComputedStyle(element).color), 'rgb(22, 112, 60)');

  const runFailure = page.locator('#runs-body .pill', { hasText: 'failure' });
  assert.equal(await runFailure.evaluate((element) => getComputedStyle(element).color), 'rgb(180, 35, 24)');
  assert.equal(
    await runFailure.evaluate((element) => getComputedStyle(element).backgroundColor),
    'rgb(255, 240, 237)',
  );

  const alphaModule = page.locator('.module-item', { has: page.getByText('alpha', { exact: true }) });
  assert.equal(await alphaModule.locator('.bar').getAttribute('aria-label'), '7 success, 3 flaky, 3 failed');
  const segments = alphaModule.locator('.bar > span');
  assert.equal(await segments.count(), 3);
  assert.deepEqual(
    await segments.evaluateAll((elements) =>
      elements.map((element) => ({
        className: element.className,
        width: element.style.width,
        color: getComputedStyle(element).backgroundColor,
      })),
    ),
    [
      { className: 'bar-pass', width: '53.85%', color: 'rgb(22, 112, 60)' },
      { className: 'bar-flaky', width: '23.08%', color: 'rgb(214, 167, 0)' },
      { className: 'bar-fail', width: '23.08%', color: 'rgb(180, 35, 24)' },
    ],
  );
  assert.match(
    await alphaModule.textContent(),
    /known log outcomes13success7flaky3failed3partial logs2 failed · 1 flaky · success not recorded/,
  );
  assert.doesNotMatch(await alphaModule.textContent(), /legacy partial/);

  const macRiskCard = page.locator('#risk-cards .risk-card').filter({ hasText: 'Mac risk route' });
  assert.deepEqual(await macRiskCard.locator('.risk-meta .pill').allTextContents(), [
    '1 success',
    '1 flaky signals',
    '5 failure signals',
    '5 failed attempts',
  ]);
  assert.deepEqual(
    await Promise.all([
      page.locator('#metric-flaky').evaluate((element) => getComputedStyle(element).color),
      macRiskCard.locator('.pill.tone-flaky').evaluate((element) => getComputedStyle(element).color),
      alphaModule.locator('.module-row.tone-flaky strong').evaluate((element) => getComputedStyle(element).color),
    ]),
    ['rgb(138, 109, 0)', 'rgb(138, 109, 0)', 'rgb(138, 109, 0)'],
  );

  const unknownModule = page.locator('.module-item', { has: page.getByText('unknown', { exact: true }) });
  assert.equal(await unknownModule.locator('.bar-skip').count(), 0);
  assert.equal(await unknownModule.locator('.bar-fail').evaluate((element) => element.style.width), '100%');

  const passingRoute = page.locator('#routes-body tr').filter({ hasText: 'Passing route' });
  assert.equal(await passingRoute.count(), 1);
  const passingHistory = passingRoute.locator('[data-label="Historical outcomes"]');
  assert.match(
    await passingHistory.textContent(),
    /Complete logs100\.00%7 complete · 7 success · 0 flaky · 0 failedPartial logs: 2 failed · 1 flaky · success not recorded/,
  );
  assert.equal(await passingHistory.locator('.signal-box').count(), 0);
  assert.doesNotMatch(await passingHistory.textContent(), /Legacy partial history/);
  assert.doesNotMatch(await passingHistory.textContent(), /All log signals/);
  assert.equal(await passingHistory.locator('.outcome-tier').count(), 0);

  const macRiskRoute = page.locator('#routes-body tr').filter({ hasText: 'Mac risk route' });
  const macRiskHistory = macRiskRoute.locator('[data-label="Historical outcomes"]');
  assert.deepEqual(
    await macRiskHistory.locator('.bar > span').evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).backgroundColor),
    ),
    ['rgb(22, 112, 60)', 'rgb(214, 167, 0)', 'rgb(180, 35, 24)'],
  );
  assert.equal(await macRiskHistory.locator('.outcome-tier').count(), 0);
  assert.match(
    await macRiskHistory.textContent(),
    /Partial logs: 4 failed · 0 flaky · success not recorded/,
  );
  assert.doesNotMatch(await macRiskHistory.textContent(), /Partial logs: 5 failed/);

  const macRiskPlatform = macRiskRoute
    .locator('[data-label="Platform detail"] .platform-chip')
    .filter({ hasText: 'macOS' });
  assert.match(
    await macRiskPlatform.textContent(),
    /Partial logs: 4 failed · 0 flaky · success not recorded/,
  );
  assert.doesNotMatch(await macRiskPlatform.textContent(), /Legacy partial history/);

  const macosHealth = page.locator('#platform-cards .platform-card').filter({ hasText: 'macOS' });
  assert.match(
    await macosHealth.textContent(),
    /Partial logs: 7 failed · 1 flaky · success not recorded/,
  );
  assert.match(
    await macosHealth.textContent(),
    /8 failed attempts across complete and partial log history/,
  );
  assert.doesNotMatch(await macosHealth.textContent(), /Legacy partial history/);

  await page.close();
});

test('dashboard filters by multiple modules and remains understandable on mobile', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.querySelector('#metric-runs')?.textContent === '4');

  assert.equal(
    await page.locator('.route-sort-note').textContent(),
    'Sorted by success rate = success / complete outcomes, lowest first. Flaky and failed outcomes are not success; routes without complete outcomes appear last.',
  );
  assert.equal(await page.locator('#filter').count(), 0);
  assert.equal(await page.locator('#platform').count(), 0);
  assert.equal(await page.locator('#sort').count(), 0);
  assert.deepEqual(await page.locator('#routes-body .route-title').allTextContents(), [
    'Failed route',
    'Flaky route',
    'Mac risk route',
    'Windows risk route',
    'Passing route',
    'Unknown route',
  ]);

  const alphabetModuleTrigger = page.getByRole('button', { name: 'Filter routes by module alphabet', exact: true });
  assert.equal(await alphabetModuleTrigger.count(), 1);
  const alphabetModuleCard = page.locator('.module-item[data-module-card="alphabet"]');
  await alphabetModuleTrigger.focus();
  assert.deepEqual(
    await alphabetModuleCard.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.outlineColor, style: style.outlineStyle, width: style.outlineWidth };
    }),
    { color: 'rgb(37, 99, 235)', style: 'solid', width: '3px' },
  );
  await alphabetModuleTrigger.click();
  assert.equal(await alphabetModuleTrigger.getAttribute('aria-pressed'), 'true');
  assert.equal(await alphabetModuleTrigger.getAttribute('aria-controls'), 'route-explorer');
  assert.equal(await page.locator('#module-filter-summary').textContent(), 'alphabet');
  assert.deepEqual(
    await page.locator('#module-filter-options input:checked').evaluateAll((inputs) => inputs.map((input) => input.value)),
    ['alphabet'],
  );
  assert.deepEqual(await page.locator('#routes-body .route-title').allTextContents(), ['Windows risk route']);
  assert.equal(
    await page.locator('#route-explorer-title').evaluate((element) => document.activeElement === element),
    true,
  );
  await page.waitForFunction(() => {
    const element = document.querySelector('#route-explorer-title');
    const rect = element?.getBoundingClientRect();
    return rect && rect.top >= 0 && rect.bottom <= window.innerHeight;
  });

  await page.locator('#module-filter summary').click();
  assert.deepEqual(
    await page.locator('#module-filter-options input[type="checkbox"]').evaluateAll((inputs) =>
      inputs.map((input) => ({ value: input.value, label: input.labels[0]?.textContent.trim() })),
    ),
    [
      { value: 'alpha', label: 'alpha' },
      { value: 'alphabet', label: 'alphabet' },
      { value: 'beta', label: 'beta' },
      { value: 'unknown', label: 'unknown' },
    ],
  );

  await page.locator('#module-filter-clear').click();
  assert.equal(await page.locator('#module-filter-summary').textContent(), 'All modules');
  assert.equal(await page.locator('#routes-body tr').count(), 6);

  await page.getByRole('checkbox', { name: 'alpha', exact: true }).check();
  assert.deepEqual(await page.locator('#routes-body .route-title').allTextContents(), [
    'Failed route',
    'Flaky route',
    'Passing route',
  ]);
  assert.equal(await page.locator('#module-filter-summary').textContent(), 'alpha');

  await page.getByRole('checkbox', { name: 'beta', exact: true }).check();
  assert.deepEqual(await page.locator('#routes-body .route-title').allTextContents(), [
    'Failed route',
    'Flaky route',
    'Mac risk route',
    'Windows risk route',
    'Passing route',
  ]);
  assert.equal(await page.locator('#module-filter-summary').textContent(), '2 modules');

  await page.getByRole('checkbox', { name: 'alpha', exact: true }).uncheck();
  assert.deepEqual(await page.locator('#routes-body .route-title').allTextContents(), [
    'Mac risk route',
    'Windows risk route',
  ]);

  await page.locator('#module-filter-clear').click();
  assert.equal(await page.locator('#routes-body tr').count(), 6);
  assert.equal(await page.locator('#module-filter-summary').textContent(), 'All modules');

  await page.locator('#search').fill('Failed route');
  assert.equal(await page.locator('#routes-body tr').count(), 1);
  assert.match(await page.locator('#routes-body').textContent(), /Failed route/);
  await page.locator('#search').fill('');

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    true,
  );
  const firstCell = page.locator('#routes-body td').first();
  assert.notEqual(await firstCell.getAttribute('data-label'), null);
  assert.notEqual(
    await firstCell.evaluate((element) => getComputedStyle(element, '::before').content),
    'none',
  );

  await page.close();
});

test('dashboard recomputes route outcomes for the selected time range', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.querySelector('#metric-runs')?.textContent === '4');

  const timeRange = page.getByLabel('Time range', { exact: true });
  assert.deepEqual(
    await timeRange.locator('option').evaluateAll((options) =>
      options.map((option) => ({ label: option.textContent.trim(), value: option.value })),
    ),
    [
      { label: 'All time', value: 'all' },
      { label: 'Last 30 days', value: '30d' },
      { label: 'Last 7 days', value: '7d' },
      { label: 'Last 24 hours', value: '1d' },
    ],
  );
  const globalMetricsBefore = await page.evaluate(() => ({
    observations: document.querySelector('#metric-observations')?.textContent,
    passRate: document.querySelector('#metric-pass-rate')?.textContent,
    modules: document.querySelector('#module-count')?.textContent,
  }));

  await timeRange.selectOption('30d');
  await expectRouteTitles(page, ['Passing route', 'Windows risk route']);
  assert.match(
    await page.locator('#routes-body tr').filter({ hasText: 'Passing route' }).textContent(),
    /3 complete · 1 success · 1 flaky · 1 failed/,
  );
  assert.match(
    await page.locator('#routes-body tr').filter({ hasText: 'Windows risk route' }).textContent(),
    /WindowsLatest flakyComplete logs: 66\.67% · 3 obs · 2 success · 1 flaky · 0 failed/,
  );
  const passingThirtyDayHistory = page
    .locator('#routes-body tr')
    .filter({ hasText: 'Passing route' })
    .locator('[data-label="Historical outcomes"]');
  assert.deepEqual(
    await passingThirtyDayHistory.locator('.bar > span').evaluateAll((elements) =>
      elements.map((element) => ({
        className: element.className,
        width: element.style.width,
        color: getComputedStyle(element).backgroundColor,
      })),
    ),
    [
      { className: 'bar-pass', width: '33.33%', color: 'rgb(22, 112, 60)' },
      { className: 'bar-flaky', width: '33.33%', color: 'rgb(214, 167, 0)' },
      { className: 'bar-fail', width: '33.33%', color: 'rgb(180, 35, 24)' },
    ],
  );

  await timeRange.selectOption('7d');
  await page.waitForFunction(() =>
    document.querySelector('#routes-body')?.textContent.includes('2 complete · 1 success · 1 flaky · 0 failed'),
  );
  await expectRouteTitles(page, ['Passing route', 'Windows risk route']);
  assert.match(
    await page.locator('#routes-body tr').filter({ hasText: 'Passing route' }).textContent(),
    /2 complete · 1 success · 1 flaky · 0 failed/,
  );

  await timeRange.selectOption('1d');
  await expectRouteTitles(page, ['Windows risk route', 'Passing route']);
  assert.match(
    await page.locator('#routes-body tr').filter({ hasText: 'Windows risk route' }).textContent(),
    /1 complete · 0 success · 1 flaky · 0 failed/,
  );
  const windowsOneDayPlatforms = page
    .locator('#routes-body tr')
    .filter({ hasText: 'Windows risk route' })
    .locator('[data-label="Platform detail"]');
  assert.match(
    await windowsOneDayPlatforms.locator('.platform-chip').filter({ hasText: 'macOS' }).textContent(),
    /macOSno data/,
  );
  assert.match(
    await windowsOneDayPlatforms.locator('.platform-chip').filter({ hasText: 'Windows' }).textContent(),
    /WindowsLatest flakyComplete logs: 0\.00% · 1 obs · 0 success · 1 flaky · 0 failed/,
  );

  await page.locator('#module-filter summary').click();
  await page.getByRole('checkbox', { name: 'alpha', exact: true }).check();
  await expectRouteTitles(page, ['Passing route']);
  await page.getByRole('checkbox', { name: 'beta', exact: true }).check();
  await expectRouteTitles(page, ['Windows risk route', 'Passing route']);

  await page.locator('#module-filter-clear').click();
  await page.getByRole('checkbox', { name: 'unknown', exact: true }).check();
  await expectRouteTitles(page, []);
  assert.equal(await page.locator('#routes-body .empty').textContent(), 'No matching routes in this time range.');
  assert.equal(await page.locator('#route-count').textContent(), '0 of 0 matching routes');

  await page.locator('#module-filter-clear').click();
  await timeRange.selectOption('all');
  await expectRouteTitles(page, [
    'Failed route',
    'Flaky route',
    'Mac risk route',
    'Windows risk route',
    'Passing route',
    'Unknown route',
  ]);
  assert.deepEqual(
    await page.evaluate(() => ({
      observations: document.querySelector('#metric-observations')?.textContent,
      passRate: document.querySelector('#metric-pass-rate')?.textContent,
      modules: document.querySelector('#module-count')?.textContent,
    })),
    globalMetricsBefore,
  );

  await page.close();
});

async function expectRouteTitles(page, expected) {
  await page.waitForFunction(
    (titles) =>
      JSON.stringify([...document.querySelectorAll('#routes-body .route-title')].map((element) => element.textContent)) ===
      JSON.stringify(titles),
    expected,
  );
  assert.deepEqual(await page.locator('#routes-body .route-title').allTextContents(), expected);
}

function writeDashboardFixture(repoRoot) {
  const dataDir = path.join(repoRoot, 'data');
  mkdirSync(dataDir, { recursive: true });

  const routes = [
    route('pass.spec.ts :: Passing route', 'pass.spec.ts', 'Passing route', 'alpha'),
    route('flaky.spec.ts :: Flaky route', 'flaky.spec.ts', 'Flaky route', 'alpha'),
    route('failed.spec.ts :: Failed route', 'failed.spec.ts', 'Failed route', 'alpha'),
    route('unknown.spec.ts :: Unknown route', 'unknown.spec.ts', 'Unknown route', 'unknown'),
    route('mac-risk.spec.ts :: Mac risk route', 'mac-risk.spec.ts', 'Mac risk route', 'beta'),
    route('windows-risk.spec.ts :: Windows risk route', 'windows-risk.spec.ts', 'Windows risk route', 'beta;alphabet'),
  ];
  const stats = [
    stat(routes[0].route_id, 'alpha', {
      fullRuns: 7,
      logFailed: 2,
      logFlaky: 1,
      logSignals: 10,
      outcome: 'passed',
      passRate: '1.0000',
    }),
    stat(routes[1].route_id, 'alpha', {
      fullRuns: 2,
      fullFlaky: 2,
      logFlaky: 2,
      outcome: 'flaky',
      passRate: '0.0000',
      attempts: 2,
    }),
    stat(routes[2].route_id, 'alpha', {
      fullRuns: 1,
      fullFailed: 1,
      logFailed: 1,
      outcome: 'failed',
      passRate: '0.0000',
      attempts: 1,
      error: 'Error: fixture failure',
    }),
    stat(routes[3].route_id, 'unknown', {
      fullRuns: 0,
      logFailed: 1,
      outcome: 'failed',
      passRate: '',
      error: 'Legacy partial signal',
    }),
    stat(routes[4].route_id, 'beta', {
      fullRuns: 3,
      fullFailed: 1,
      fullFlaky: 1,
      logFailed: 5,
      logFlaky: 1,
      logSignals: 7,
      outcome: 'passed',
      passRate: '0.3333',
      attempts: 5,
    }),
    stat(routes[5].route_id, 'beta;alphabet', {
      fullRuns: 2,
      fullFailed: 1,
      logFailed: 10,
      logSignals: 11,
      outcome: 'failed',
      passRate: '0.5000',
      attempts: 10,
    }),
  ];
  const platformStats = stats.slice(0, 4).map((row) => toPlatformStat(row, 'macos'));
  platformStats.push(
    toPlatformStat(
      stat(routes[4].route_id, 'beta', {
        fullRuns: 2,
        fullFailed: 1,
        fullFlaky: 1,
        logFailed: 5,
        logFlaky: 1,
        logSignals: 6,
        outcome: 'failed',
        passRate: '0.0000',
        attempts: 5,
      }),
      'macos',
    ),
    toPlatformStat(stat(routes[4].route_id, 'beta', { fullRuns: 1, outcome: 'passed', passRate: '1.0000' }), 'windows'),
    toPlatformStat(stat(routes[5].route_id, 'beta;alphabet', { fullRuns: 1, outcome: 'passed', passRate: '1.0000' }), 'macos'),
    toPlatformStat(
      stat(routes[5].route_id, 'beta;alphabet', {
        fullRuns: 1,
        fullFailed: 1,
        logFailed: 10,
        logSignals: 10,
        outcome: 'failed',
        passRate: '0.0000',
        attempts: 10,
      }),
      'windows',
    ),
  );
  const day = 24 * 60 * 60 * 1000;
  const fixtureNow = new Date(fixtureAsOf).getTime();
  const runs = [
    dashboardRun('1', '100', fixtureNow - 40 * day, 'failure'),
    dashboardRun('2', '101', fixtureNow - 15 * day, 'success'),
    dashboardRun('3', '102', fixtureNow - 3 * day, 'success'),
    dashboardRun('4', '103', fixtureNow - day / 2, 'success'),
  ];
  const routeResults = [
    dashboardResult('1', routes[0].route_id, 'passed', 'macos'),
    dashboardResult('2', routes[0].route_id, 'failed', 'macos'),
    dashboardResult('3', routes[0].route_id, 'flaky', 'macos'),
    dashboardResult('4', routes[0].route_id, 'passed', 'macos'),
    dashboardResult('1', routes[5].route_id, 'failed', 'windows'),
    dashboardResult('2', routes[5].route_id, 'passed', 'windows'),
    dashboardResult('3', routes[5].route_id, 'passed', 'windows'),
    dashboardResult('4', routes[5].route_id, 'flaky', 'windows'),
  ];

  writeCsv(path.join(dataDir, 'routes.csv'), HEADERS.routes, routes);
  writeCsv(path.join(dataDir, 'runs.csv'), HEADERS.runs, runs);
  writeRouteResults({ repoRoot, rows: routeResults, runs });
  writeCsv(path.join(dataDir, 'route_stats.csv'), HEADERS.routeStats, stats);
  writeCsv(path.join(dataDir, 'route_platform_stats.csv'), HEADERS.routePlatformStats, platformStats);
}

function dashboardRun(runId, runNumber, completedAt, conclusion) {
  return {
    run_id: runId,
    run_attempt: '1',
    run_number: runNumber,
    workflow: 'CI',
    branch: 'main',
    sha: `sha-${runId}`,
    event: 'push',
    pr_number: '',
    started_at: new Date(completedAt - 60 * 60 * 1000).toISOString(),
    completed_at: new Date(completedAt).toISOString(),
    conclusion,
    data_source: 'job_log_route_metric',
  };
}

function dashboardResult(runId, routeId, outcome, platform) {
  return {
    run_id: runId,
    run_attempt: '1',
    platform,
    project: 'electron',
    route_id: routeId,
    outcome,
    duration_ms: '100',
    retry_count: outcome === 'flaky' ? '1' : '0',
    attempt_failures: outcome === 'passed' ? '0' : '1',
    error_signature: outcome === 'failed' ? 'Error: fixture window failure' : '',
    artifact_url: '',
    data_source: 'job_log_route_metric',
  };
}

function route(routeId, specFile, titlePath, moduleTags) {
  return {
    route_id: routeId,
    spec_file: specFile,
    spec_basename: specFile,
    title_path: titlePath,
    module_tags: moduleTags,
    first_seen_at: '2026-07-08T11:00:00Z',
    last_seen_at: '2026-07-09T11:00:00Z',
    status: 'active',
  };
}

function stat(routeId, moduleTags, overrides = {}) {
  const fullRuns = overrides.fullRuns ?? 0;
  const fullFailed = overrides.fullFailed ?? 0;
  const fullFlaky = overrides.fullFlaky ?? 0;
  const logFailed = overrides.logFailed ?? fullFailed;
  const logFlaky = overrides.logFlaky ?? fullFlaky;
  const logSignals = overrides.logSignals ?? (fullRuns || logFailed + logFlaky);
  return {
    route_id: routeId,
    module_tags: moduleTags,
    total_runs: String(fullRuns || logFailed + logFlaky),
    full_runs: String(fullRuns),
    full_failed_runs: String(fullFailed),
    full_flaky_runs: String(fullFlaky),
    log_signal_runs: String(logSignals),
    log_failed_runs: String(logFailed),
    log_flaky_runs: String(logFlaky),
    failed_runs: String(logFailed),
    flaky_runs: String(logFlaky),
    attempt_failures: String(overrides.attempts ?? 0),
    pass_rate: overrides.passRate ?? '',
    failed_runs_macos: String(logFailed),
    failed_runs_windows: '0',
    last_outcome: overrides.outcome ?? 'unknown',
    last_failed_at: logFailed ? '2026-07-09T11:00:00Z' : '',
    top_error_signature: overrides.error ?? '',
  };
}

function toPlatformStat(row, platform) {
  return {
    route_id: row.route_id,
    platform,
    module_tags: row.module_tags,
    total_runs: row.total_runs,
    full_runs: row.full_runs,
    full_failed_runs: row.full_failed_runs,
    full_flaky_runs: row.full_flaky_runs,
    log_signal_runs: row.log_signal_runs,
    log_failed_runs: row.log_failed_runs,
    log_flaky_runs: row.log_flaky_runs,
    failed_runs: row.failed_runs,
    flaky_runs: row.flaky_runs,
    attempt_failures: row.attempt_failures,
    pass_rate: row.pass_rate,
    last_outcome: row.last_outcome,
    last_failed_at: row.last_failed_at,
    top_error_signature: row.top_error_signature,
  };
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsv(row[header] ?? '')).join(','));
  }
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function escapeCsv(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function createStaticServer(distDir) {
  return createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(distDir, relativePath);
    if (!filePath.startsWith(path.resolve(distDir))) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const content = readFileSync(filePath);
      response.writeHead(200, { 'content-type': contentType(filePath) });
      response.end(content);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.csv')) return 'text/csv; charset=utf-8';
  return 'application/octet-stream';
}

async function launchBrowserServer() {
  try {
    return await chromium.launchServer({ headless: true });
  } catch {
    return chromium.launchServer({ channel: 'chrome', headless: true });
  }
}
