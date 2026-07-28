import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HEADERS, stringifyCsv } from '../src/metrics-core.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureAsOf = '2026-07-29T00:00:00.000Z';

test('builds a multi-shard dashboard within a bounded Node heap', { timeout: 120_000 }, () => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'e2e-ci-pages-memory-'));

  try {
    writeLargeShardedFixture(repoRoot);
    const result = spawnSync(process.execPath, [path.join(projectRoot, 'src', 'build-pages.mjs')], {
      cwd: repoRoot,
      env: {
        ...process.env,
        METRICS_AS_OF: fixtureAsOf,
        NODE_OPTIONS: '--max-old-space-size=64',
      },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 90_000,
    });

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);

    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'dist', 'manifest.json'), 'utf8'));
    const windows = JSON.parse(
      readFileSync(path.join(repoRoot, 'dist', 'data', 'window_stats.json'), 'utf8'),
    );
    assert.equal(manifest.files.route_results.shard_count, 36);
    assert.equal(manifest.files.route_results.data_rows, 72_000);
    assert.equal(windows.windows['30d'].routeStats.length, 50);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('builds one large route-result shard within a bounded Node heap', { timeout: 120_000 }, () => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'e2e-ci-pages-large-shard-'));

  try {
    writeLargeShardedFixture(repoRoot, { dayCount: 1, runsPerDay: 720 });
    const result = spawnSync(process.execPath, [path.join(projectRoot, 'src', 'build-pages.mjs')], {
      cwd: repoRoot,
      env: {
        ...process.env,
        METRICS_AS_OF: fixtureAsOf,
        NODE_OPTIONS: '--max-old-space-size=64',
      },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 90_000,
    });

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'dist', 'manifest.json'), 'utf8'));
    assert.equal(manifest.files.route_results.shard_count, 1);
    assert.equal(manifest.files.route_results.data_rows, 72_000);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

function writeLargeShardedFixture(repoRoot, { dayCount = 36, runsPerDay = 20 } = {}) {
  const dataDir = path.join(repoRoot, 'data');
  const shardDir = path.join(dataDir, 'route_results');
  mkdirSync(shardDir, { recursive: true });

  const routes = Array.from({ length: 50 }, (_, index) => ({
    route_id: `route-${index}.spec.ts :: Route ${index}`,
    spec_file: `route-${index}.spec.ts`,
    spec_basename: `route-${index}.spec.ts`,
    title_path: `Route ${index}`,
    module_tags: `module-${index % 5}`,
    first_seen_at: '2026-06-23T00:00:00.000Z',
    last_seen_at: '2026-07-28T23:00:00.000Z',
    status: 'active',
  }));
  const runs = [];
  const startTime = Date.UTC(2026, 5, 23);
  let runNumber = 1;

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const dayTime = startTime + dayIndex * 24 * 60 * 60 * 1000;
    const day = new Date(dayTime).toISOString().slice(0, 10);
    const rows = [];

    for (let dailyRun = 0; dailyRun < runsPerDay; dailyRun += 1) {
      const runId = String(runNumber);
      const intervalMs = dayCount === 1 ? 2 * 60 * 1000 : 60 * 60 * 1000;
      const completedAt = new Date(dayTime + dailyRun * intervalMs + 60 * 1000).toISOString();
      runs.push({
        run_id: runId,
        run_attempt: '1',
        run_number: runId,
        workflow: 'CI',
        branch: 'main',
        sha: `sha-${runId}`,
        event: 'push',
        pr_number: '',
        started_at: new Date(new Date(completedAt).getTime() - 30 * 60 * 1000).toISOString(),
        completed_at: completedAt,
        conclusion: 'success',
        data_source: 'job_log_route_metric',
      });

      for (const route of routes) {
        for (const platform of ['macos', 'windows']) {
          rows.push({
            run_id: runId,
            run_attempt: '1',
            platform,
            project: 'electron',
            route_id: route.route_id,
            outcome: 'passed',
            duration_ms: '100',
            retry_count: '0',
            attempt_failures: '0',
            error_signature: '',
            artifact_url: '',
            data_source: 'job_log_route_metric',
          });
        }
      }
      runNumber += 1;
    }

    writeCsv(path.join(shardDir, `${day}.csv`), HEADERS.routeResults, rows);
  }

  writeCsv(path.join(dataDir, 'routes.csv'), HEADERS.routes, routes);
  writeCsv(path.join(dataDir, 'runs.csv'), HEADERS.runs, runs);
  writeCsv(path.join(dataDir, 'route_stats.csv'), HEADERS.routeStats, []);
  writeCsv(path.join(dataDir, 'route_platform_stats.csv'), HEADERS.routePlatformStats, []);
}

function writeCsv(filePath, headers, rows) {
  writeFileSync(filePath, stringifyCsv(headers, rows), 'utf8');
}
