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

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'e2e-ci-route-failures-'));
const routeId =
  'keyboard-shortcuts.spec.ts :: Keyboard Shortcuts > File list: selection/navigation/rename/copy path + Escape overlay precedence';
let browser;
let browserServer;
let baseUrl;
let server;

before(async () => {
  writeFixture(fixtureRoot);
  execFileSync(process.execPath, [path.join(projectRoot, 'src', 'build-pages.mjs')], {
    cwd: fixtureRoot,
    stdio: 'pipe',
  });
  server = createStaticServer(path.join(fixtureRoot, 'dist'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
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

test('route explorer expands failed commits with PR and platform evidence', async () => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.querySelector('#metric-runs')?.textContent === '4');

  await page.getByLabel('Search').fill('Escape overlay precedence');
  const routeRow = page.locator('#routes-body > tr').filter({ hasText: 'Escape overlay precedence' });
  const trigger = routeRow.getByRole('button', { name: /View failed commits/ });

  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await trigger.click();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');

  const detail = page.locator('#routes-body > tr.failure-history-detail');
  await detail.getByText('2 failed commits').waitFor();
  const commits = detail.locator('[data-failure-commit]');
  assert.equal(await commits.count(), 2);
  assert.deepEqual(await commits.locator('[data-label="Commit"] a').allTextContents(), ['bbbbbbbb', 'aaaaaaaa']);
  assert.deepEqual(await commits.locator('[data-label="PR"]').allTextContents(), ['Not recorded', '#1201#1203']);
  assert.deepEqual(await commits.nth(1).locator('[data-label="PR"] a').allTextContents(), ['#1201', '#1203']);
  assert.match(await commits.nth(0).locator('[data-label="Platforms"]').textContent(), /Windows/);
  assert.match(await commits.nth(1).locator('[data-label="Platforms"]').textContent(), /macOS.*Windows/);
  assert.equal(await detail.getByText('cccccccc', { exact: true }).count(), 0);
  assert.equal(await detail.getByRole('link', { name: /Run #501/ }).count(), 1);
  assert.equal(await detail.getByRole('link', { name: /Run #500/ }).count(), 1);
  assert.equal(await detail.getByRole('link', { name: /Run #503/ }).count(), 1);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.doesNotMatch(await detail.locator('.failure-history-heading').textContent(), /keyboard-shortcuts\.spec\.ts/);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    true,
  );

  await trigger.click();
  assert.equal(await page.locator('#routes-body > tr.failure-history-detail').count(), 0);
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await trigger.evaluate((element) => document.activeElement === element), true);

  await page.close();
});

function writeFixture(repoRoot) {
  const dataDir = path.join(repoRoot, 'data');
  mkdirSync(dataDir, { recursive: true });
  const route = {
    route_id: routeId,
    spec_file: 'keyboard-shortcuts.spec.ts',
    spec_basename: 'keyboard-shortcuts.spec.ts',
    title_path: routeId.split(' :: ')[1],
    module_tags: 'keyboard-shortcuts',
    first_seen_at: '2026-06-01T00:00:00Z',
    last_seen_at: '2026-06-04T00:00:00Z',
    status: 'active',
  };
  const runs = [
    run('100', '500', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-06-02T12:00:00Z', '1201'),
    run('101', '501', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '2026-06-03T12:00:00Z', ''),
    run('102', '502', 'cccccccccccccccccccccccccccccccccccccccc', '2026-06-04T12:00:00Z', '1202'),
    run('103', '503', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-06-01T12:00:00Z', '1203'),
  ];
  const results = [
    result('100', 'macos', 'failed', 'https://github.com/AOE-HQ/aoe-desktop/actions/runs/100/job/1'),
    result('100', 'windows', 'failed', 'https://github.com/AOE-HQ/aoe-desktop/actions/runs/100/job/2'),
    result('101', 'windows', 'failed', 'https://github.com/AOE-HQ/aoe-desktop/actions/runs/101/job/3'),
    result('102', 'macos', 'flaky', 'https://github.com/AOE-HQ/aoe-desktop/actions/runs/102/job/4'),
    result('103', 'macos', 'failed', 'https://github.com/AOE-HQ/aoe-desktop/actions/runs/103/job/5'),
  ];
  const stat = {
    route_id: routeId,
    module_tags: 'keyboard-shortcuts',
    total_runs: '5',
    full_runs: '5',
    full_failed_runs: '4',
    full_flaky_runs: '1',
    log_signal_runs: '5',
    log_failed_runs: '4',
    log_flaky_runs: '1',
    failed_runs: '4',
    flaky_runs: '1',
    attempt_failures: '5',
    pass_rate: '0.0000',
    failed_runs_macos: '2',
    failed_runs_windows: '2',
    last_outcome: 'flaky',
    last_failed_at: '2026-06-03T12:00:00Z',
    top_error_signature: 'Error: fixture failure',
  };
  const platformStats = [
    { ...stat, platform: 'macos', total_runs: '3', full_runs: '3', full_failed_runs: '2', full_flaky_runs: '1' },
    { ...stat, platform: 'windows', total_runs: '2', full_runs: '2', full_failed_runs: '2', full_flaky_runs: '0' },
  ];

  writeCsv(path.join(dataDir, 'routes.csv'), HEADERS.routes, [route]);
  writeCsv(path.join(dataDir, 'runs.csv'), HEADERS.runs, runs);
  writeCsv(path.join(dataDir, 'route_results.csv'), HEADERS.routeResults, results);
  writeCsv(path.join(dataDir, 'route_stats.csv'), HEADERS.routeStats, [stat]);
  writeCsv(path.join(dataDir, 'route_platform_stats.csv'), HEADERS.routePlatformStats, platformStats);
}

function run(runId, runNumber, sha, completedAt, prNumber) {
  return {
    run_id: runId,
    run_attempt: '1',
    run_number: runNumber,
    workflow: 'CI',
    branch: `feature/${runId}`,
    sha,
    event: 'pull_request',
    pr_number: prNumber,
    started_at: '2026-06-01T00:00:00Z',
    completed_at: completedAt,
    conclusion: 'failure',
    data_source: 'job_log_route_metric',
  };
}

function result(runId, platform, outcome, artifactUrl) {
  return {
    run_id: runId,
    run_attempt: '1',
    platform,
    project: 'electron',
    route_id: routeId,
    outcome,
    duration_ms: '100',
    retry_count: outcome === 'flaky' ? '1' : '0',
    attempt_failures: '1',
    error_signature: `Error: ${platform} fixture failure`,
    artifact_url: artifactUrl,
    data_source: 'job_log_route_metric',
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
    let content;
    try {
      content = readFileSync(filePath);
    } catch {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': contentType(filePath) });
    response.end(content);
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
