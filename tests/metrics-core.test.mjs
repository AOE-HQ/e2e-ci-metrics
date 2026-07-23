import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {
  HEADERS,
  JOB_LOG_FAILURE_SOURCE,
  JOB_LOG_ROUTE_METRIC_SOURCE,
  computeWindowedMetrics,
  extractRouteResultsFromJobLog,
  extractRouteResultsFromReport,
  readTable,
  recomputeAggregateTables,
  stringifyCsv,
  updateMetrics,
  updateMetricsBatch,
} from '../src/metrics-core.mjs';
import { readRouteResults } from '../src/route-results-store.mjs';

describe('E2E CI metrics core', () => {
  it('derives route id from spec file and full title path', () => {
    const repo = createTempRepo();
    const report = writeReport(repo, 'macos-report.json', sampleReport({ finalStatus: 'passed' }));

    const results = extractRouteResultsFromReport(report, {
      platform: 'macos',
      artifactUrl: 'https://github.com/AOE-HQ/aoe-desktop/actions/runs/1',
    });

    assert.equal(results.length, 1);
    assert.deepEqual(pick(results[0], ['spec_file', 'spec_basename', 'title_path', 'route_id', 'outcome', 'platform', 'project']), {
      spec_file: 'tests/e2e/specs/chat-input.spec.ts',
      spec_basename: 'chat-input.spec.ts',
      title_path: 'composer behavior > sends with keyboard',
      route_id: 'tests/e2e/specs/chat-input.spec.ts :: composer behavior > sends with keyboard',
      outcome: 'passed',
      platform: 'macos',
      project: 'electron',
    });
  });

  it('aggregates log route metrics into full observations, platform failures, and raw attempt failures', () => {
    const repo = createTempRepo();
    const logResults = [
      ...extractRouteResultsFromJobLog(
        routeMetricLogLine({
          platform: 'macos',
          outcome: 'flaky',
          duration_ms: 22,
          retry_count: 1,
          attempt_failures: 1,
          error_signature: 'Error: first attempt failed',
        }),
        { platform: 'macos' },
      ),
      ...extractRouteResultsFromJobLog(
        routeMetricLogLine({
          platform: 'windows',
          outcome: 'failed',
          duration_ms: 20,
          retry_count: 0,
          attempt_failures: 1,
          error_signature: 'Error: windows failed',
        }),
        { platform: 'windows' },
      ),
    ];

    updateMetrics({
      repoRoot: repo,
      reports: [],
      results: logResults,
      run: baseRun(),
      artifactUrl: 'https://github.com/AOE-HQ/aoe-desktop/actions/runs/123',
    });

    const results = readRouteResults({ repoRoot: repo });
    const stats = readTable(path.join(repo, 'data', 'route_stats.csv'), HEADERS.routeStats);
    const platformStats = readTable(
      path.join(repo, 'data', 'route_platform_stats.csv'),
      HEADERS.routePlatformStats,
    );

    assert.equal(results.length, 2);
    assert.deepEqual(results.map((row) => `${row.platform}:${row.outcome}`).sort(), ['macos:flaky', 'windows:failed']);
    assert.equal(stats.length, 1);
    assert.deepEqual(
      pick(stats[0], [
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
      ]),
      {
        total_runs: '2',
        full_runs: '2',
        full_failed_runs: '1',
        full_flaky_runs: '1',
        log_signal_runs: '2',
        log_failed_runs: '1',
        log_flaky_runs: '1',
        failed_runs: '1',
        flaky_runs: '1',
        attempt_failures: '2',
        pass_rate: '0.0000',
        failed_runs_macos: '0',
        failed_runs_windows: '1',
        last_outcome: 'failed',
        last_failed_at: '2026-07-07T12:00:00.000Z',
        top_error_signature: 'Error: first attempt failed',
      },
    );
    assert.deepEqual(
      results.map((row) => row.data_source),
      [JOB_LOG_ROUTE_METRIC_SOURCE, JOB_LOG_ROUTE_METRIC_SOURCE],
    );
    assert.deepEqual(
      platformStats.map((row) =>
        pick(row, [
          'platform',
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
        ]),
      ),
      [
        {
          platform: 'macos',
          total_runs: '1',
          full_runs: '1',
          full_failed_runs: '0',
          full_flaky_runs: '1',
          log_signal_runs: '1',
          log_failed_runs: '0',
          log_flaky_runs: '1',
          failed_runs: '0',
          flaky_runs: '1',
          attempt_failures: '1',
          pass_rate: '0.0000',
          last_outcome: 'flaky',
        },
        {
          platform: 'windows',
          total_runs: '1',
          full_runs: '1',
          full_failed_runs: '1',
          full_flaky_runs: '0',
          log_signal_runs: '1',
          log_failed_runs: '1',
          log_flaky_runs: '0',
          failed_runs: '1',
          flaky_runs: '0',
          attempt_failures: '1',
          pass_rate: '0.0000',
          last_outcome: 'failed',
        },
      ],
    );
  });

  it('extracts failed and flaky route signals from GitHub job logs', () => {
    const log = [
      '2026-07-07T14:26:08.1500000Z   1) [electron] › tests/e2e/specs/automation-scheduled-tasks.spec.ts:2324:7 › Automation scheduled tasks › hides linked source event from the month cell',
      '2026-07-07T14:26:08.1510000Z     \u001b[31mError:\u001b[39m expect(locator).toHaveCount(expected) failed',
      '2026-07-07T14:26:08.1545630Z   1 failed',
      '2026-07-07T14:26:08.1546150Z     [electron] › tests/e2e/specs/automation-scheduled-tasks.spec.ts:2324:7 › Automation scheduled tasks › hides linked source event from the month cell',
      '2026-07-07T14:26:08.1546540Z   1 flaky',
      '2026-07-07T14:26:08.1547040Z     [electron] › tests/e2e/specs/markdown-ime-and-image-paste.spec.ts:123:7 › Markdown IME composition + image paste › navigates between table cells with arrow keys',
      '2026-07-07T14:26:08.1548380Z   73 skipped',
      '2026-07-07T14:26:08.1548480Z   867 passed (18.6m)',
    ].join('\n');

    const results = extractRouteResultsFromJobLog(log, {
      platform: 'macos',
      artifactUrl: 'https://github.com/AOE-HQ/aoe-desktop/actions/runs/28871643027/job/85635752357',
    });

    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((row) =>
        pick(row, ['platform', 'route_id', 'outcome', 'attempt_failures', 'retry_count', 'data_source']),
      ),
      [
        {
          platform: 'macos',
          route_id:
            'automation-scheduled-tasks.spec.ts :: Automation scheduled tasks > hides linked source event from the month cell',
          outcome: 'failed',
          attempt_failures: '1',
          retry_count: '0',
          data_source: JOB_LOG_FAILURE_SOURCE,
        },
        {
          platform: 'macos',
          route_id:
            'markdown-ime-and-image-paste.spec.ts :: Markdown IME composition + image paste > navigates between table cells with arrow keys',
          outcome: 'flaky',
          attempt_failures: '1',
          retry_count: '1',
          data_source: JOB_LOG_FAILURE_SOURCE,
        },
      ],
    );
    assert.equal(results[0].error_signature, 'Error: expect(locator).toHaveCount(expected) failed');
  });

  it('extracts complete route outcomes from Playwright list reporter job logs', () => {
    const log = [
      '2026-07-08T20:50:13.7206820Z   ✓    2 [electron] › tests/e2e/specs/agent-im.spec.ts:7:7 › Agent IM › completes a clean route (11.6s)',
      '2026-07-08T21:03:41.6942070Z   ✘  525 [electron] › tests/e2e/specs/focus-management.spec.ts:150:9 › Focus Management › restores focus (19.2s)',
      '2026-07-08T21:03:51.3966210Z   ✓  534 [electron] › tests/e2e/specs/focus-management.spec.ts:150:9 › Focus Management › restores focus (retry #1) (8.7s)',
      '2026-07-08T21:04:05.2453160Z   ✘  538 [electron] › tests/e2e/specs/preview.spec.ts:196:9 › Preview › remains broken (13.8s)',
      '2026-07-08T21:14:16.6973860Z   -  936 [electron] › tests/e2e/specs/workspace-history.spec.ts:217:8 › Workspace History › disabled route',
      '2026-07-08T21:15:59.1400000Z   Slow test file: [electron] › tests/e2e/specs/preview.spec.ts (6.1m)',
      '2026-07-08T21:15:59.1507730Z   1 failed',
      '2026-07-08T21:15:59.1508180Z     [electron] › tests/e2e/specs/preview.spec.ts:196:9 › Preview › remains broken',
      '2026-07-08T21:15:59.1509280Z   1 flaky',
      '2026-07-08T21:15:59.1509390Z     [electron] › tests/e2e/specs/focus-management.spec.ts:150:9 › Focus Management › restores focus',
      '2026-07-08T21:15:59.1510000Z   1 skipped',
      '2026-07-08T21:15:59.1511000Z   1 passed (26.0m)',
    ].join('\n');

    const results = extractRouteResultsFromJobLog(log, { platform: 'macos' });

    assert.deepEqual(
      results.map((row) =>
        pick(row, [
          'route_id',
          'outcome',
          'duration_ms',
          'retry_count',
          'attempt_failures',
          'data_source',
        ]),
      ),
      [
        {
          route_id: 'agent-im.spec.ts :: Agent IM > completes a clean route',
          outcome: 'passed',
          duration_ms: '11600',
          retry_count: '0',
          attempt_failures: '0',
          data_source: JOB_LOG_ROUTE_METRIC_SOURCE,
        },
        {
          route_id: 'focus-management.spec.ts :: Focus Management > restores focus',
          outcome: 'flaky',
          duration_ms: '27900',
          retry_count: '1',
          attempt_failures: '1',
          data_source: JOB_LOG_ROUTE_METRIC_SOURCE,
        },
        {
          route_id: 'preview.spec.ts :: Preview > remains broken',
          outcome: 'failed',
          duration_ms: '13800',
          retry_count: '0',
          attempt_failures: '1',
          data_source: JOB_LOG_ROUTE_METRIC_SOURCE,
        },
        {
          route_id: 'workspace-history.spec.ts :: Workspace History > disabled route',
          outcome: 'skipped',
          duration_ms: '',
          retry_count: '0',
          attempt_failures: '0',
          data_source: JOB_LOG_ROUTE_METRIC_SOURCE,
        },
      ],
    );
  });

  it('does not mark a truncated list reporter log as a full observation', () => {
    const results = extractRouteResultsFromJobLog(
      [
        '2026-07-08T20:50:13.7206820Z   ✓    1 [electron] › tests/e2e/specs/agent-im.spec.ts:7:7 › Agent IM › first route (11.6s)',
        '2026-07-08T20:50:15.7206820Z   ✓    2 [electron] › tests/e2e/specs/agent-im.spec.ts:17:7 › Agent IM › second route (9.4s)',
        '2026-07-08T21:15:59.1511000Z   3 passed (26.0m)',
      ].join('\n'),
      { platform: 'macos' },
    );

    assert.deepEqual(results, []);
  });

  it('does not accept structured route metrics without matching footer totals', () => {
    const metricWithoutFooter = routeMetricLogLine().split('\n')[0];
    assert.deepEqual(extractRouteResultsFromJobLog(metricWithoutFooter, { platform: 'macos' }), []);
  });

  it('normalizes Windows list reporter outcomes and path separators', () => {
    const log = [
      '2026-07-08T21:17:23.7888490Z   ok   1 [electron] › tests\\e2e\\specs\\agent-im.spec.ts:7:7 › Agent IM › completes a clean route (11.3s)',
      '2026-07-08T21:18:38.6016099Z   x   19 [electron] › tests\\e2e\\specs\\advanced-journeys.spec.ts:146:7 › Advanced Journeys › recovers after retry (44.9s)',
      '2026-07-08T21:19:03.8087197Z   ok  36 [electron] › tests\\e2e\\specs\\advanced-journeys.spec.ts:146:7 › Advanced Journeys › recovers after retry (retry #1) (23.6s)',
      '2026-07-08T22:01:35.6265645Z   1 flaky',
      '2026-07-08T22:01:35.6271128Z   1 passed (44.5m)',
    ].join('\n');

    const results = extractRouteResultsFromJobLog(log, { platform: 'windows' });

    assert.deepEqual(
      results.map((row) => pick(row, ['platform', 'spec_file', 'outcome', 'retry_count', 'attempt_failures'])),
      [
        {
          platform: 'windows',
          spec_file: 'agent-im.spec.ts',
          outcome: 'passed',
          retry_count: '0',
          attempt_failures: '0',
        },
        {
          platform: 'windows',
          spec_file: 'advanced-journeys.spec.ts',
          outcome: 'flaky',
          retry_count: '1',
          attempt_failures: '1',
        },
      ],
    );
  });

  it('keeps log-only signals out of full pass-rate denominators', () => {
    const repo = createTempRepo();
    const logResults = extractRouteResultsFromJobLog(
      [
        '2026-07-07T14:26:08.1545630Z   1 failed',
        '2026-07-07T14:26:08.1546150Z     [electron] › tests/e2e/specs/automation-scheduled-tasks.spec.ts:2324:7 › Automation scheduled tasks › hides linked source event from the month cell',
      ].join('\n'),
      { platform: 'macos' },
    );

    updateMetrics({
      repoRoot: repo,
      reports: [],
      results: logResults,
      run: { ...baseRun(), data_source: JOB_LOG_FAILURE_SOURCE },
    });

    const stats = readTable(path.join(repo, 'data', 'route_stats.csv'), HEADERS.routeStats);
    assert.deepEqual(
      pick(stats[0], [
        'total_runs',
        'full_runs',
        'full_failed_runs',
        'full_flaky_runs',
        'log_signal_runs',
        'log_failed_runs',
        'log_flaky_runs',
        'failed_runs',
        'flaky_runs',
        'pass_rate',
      ]),
      {
        total_runs: '1',
        full_runs: '0',
        full_failed_runs: '0',
        full_flaky_runs: '0',
        log_signal_runs: '1',
        log_failed_runs: '1',
        log_flaky_runs: '0',
        failed_runs: '1',
        flaky_runs: '0',
        pass_rate: '',
      },
    );
  });

  it('recomputes route and platform outcomes inside completed-time windows', () => {
    const day = 24 * 60 * 60 * 1000;
    const routeId = 'time.spec.ts :: time-window route';
    const routes = [{ route_id: routeId, module_tags: 'time' }];
    const runs = [
      run('shared', '1', '2026-06-01T12:00:00Z'),
      run('month', '1', '2026-07-16T12:00:00Z'),
      run('week', '1', '2026-07-28T12:00:00Z'),
      run('shared', '2', '2026-07-31T00:00:00Z'),
    ];
    const routeResults = [
      result('shared', '1', routeId, 'passed', 'macos'),
      result('month', '1', routeId, 'failed', 'macos'),
      result('week', '1', routeId, 'flaky', 'windows'),
      result('shared', '2', routeId, 'passed', 'macos'),
    ];

    const metrics = computeWindowedMetrics({
      routes,
      routeResults,
      runs,
      asOf: '2026-07-31T12:00:00Z',
      windows: [
        { key: '30d', durationMs: 30 * day },
        { key: '7d', durationMs: 7 * day },
        { key: '1d', durationMs: day },
      ],
    });

    assert.equal(metrics.asOf, '2026-07-31T12:00:00.000Z');
    assert.deepEqual(
      pick(metrics.windows['30d'].routeStats[0], [
        'full_runs',
        'full_failed_runs',
        'full_flaky_runs',
        'pass_rate',
        'last_outcome',
      ]),
      {
        full_runs: '3',
        full_failed_runs: '1',
        full_flaky_runs: '1',
        pass_rate: '0.3333',
        last_outcome: 'passed',
      },
    );
    assert.deepEqual(
      pick(metrics.windows['7d'].routeStats[0], ['full_runs', 'full_flaky_runs', 'pass_rate']),
      { full_runs: '2', full_flaky_runs: '1', pass_rate: '0.5000' },
    );
    assert.deepEqual(
      pick(metrics.windows['1d'].routeStats[0], ['full_runs', 'full_failed_runs', 'full_flaky_runs', 'pass_rate']),
      { full_runs: '1', full_failed_runs: '0', full_flaky_runs: '0', pass_rate: '1.0000' },
    );
    assert.deepEqual(
      metrics.windows['30d'].routePlatformStats.map((row) =>
        pick(row, ['platform', 'full_runs', 'full_failed_runs', 'full_flaky_runs', 'pass_rate']),
      ),
      [
        { platform: 'macos', full_runs: '2', full_failed_runs: '1', full_flaky_runs: '0', pass_rate: '0.5000' },
        { platform: 'windows', full_runs: '1', full_failed_runs: '0', full_flaky_runs: '1', pass_rate: '0.0000' },
      ],
    );
  });

  it('includes exact window boundaries while excluding older, future, and invalid runs', () => {
    const day = 24 * 60 * 60 * 1000;
    const routeId = 'boundary.spec.ts :: boundary route';
    const routes = [{ route_id: routeId, module_tags: 'time' }];
    const runs = [
      run('before', '1', '2026-07-30T11:59:59.999Z'),
      run('since', '1', '2026-07-30T12:00:00.000Z'),
      run('as-of', '1', '2026-07-31T12:00:00.000Z'),
      run('future', '1', '2026-07-31T12:00:00.001Z'),
      run('invalid', '1', 'not-a-timestamp'),
    ];
    const routeResults = [
      result('before', '1', routeId, 'passed', 'macos'),
      result('since', '1', routeId, 'failed', 'macos'),
      result('as-of', '1', routeId, 'flaky', 'windows'),
      result('future', '1', routeId, 'passed', 'windows'),
      result('invalid', '1', routeId, 'passed', 'macos'),
    ];

    const metrics = computeWindowedMetrics({
      routes,
      routeResults,
      runs,
      asOf: '2026-07-31T12:00:00.000Z',
      windows: [{ key: '1d', durationMs: day }],
    });

    assert.equal(metrics.windows['1d'].since, '2026-07-30T12:00:00.000Z');
    assert.deepEqual(
      pick(metrics.windows['1d'].routeStats[0], [
        'full_runs',
        'full_failed_runs',
        'full_flaky_runs',
        'pass_rate',
        'last_outcome',
      ]),
      {
        full_runs: '2',
        full_failed_runs: '1',
        full_flaky_runs: '1',
        pass_rate: '0.0000',
        last_outcome: 'flaky',
      },
    );
  });

  it('keeps legacy artifact rows out of all dashboard aggregates', () => {
    const repo = createTempRepo();
    const report = writeReport(repo, 'electron-macos.json', sampleReport({ finalStatus: 'passed' }));

    updateMetrics({
      repoRoot: repo,
      reports: [{ platform: 'macos', path: report }],
      run: baseRun(),
    });

    assert.equal(readTable(path.join(repo, 'data', 'routes.csv'), HEADERS.routes).length, 1);
    assert.equal(readRouteResults({ repoRoot: repo }).length, 1);
    assert.deepEqual(readTable(path.join(repo, 'data', 'route_stats.csv'), HEADERS.routeStats), []);
    assert.deepEqual(
      readTable(path.join(repo, 'data', 'route_platform_stats.csv'), HEADERS.routePlatformStats),
      [],
    );
  });

  it('applies multiple imported runs in one metrics batch', () => {
    const repo = createTempRepo();
    const passed = extractRouteResultsFromJobLog(routeMetricLogLine({ outcome: 'passed' }), {
      platform: 'macos',
    });
    const failed = extractRouteResultsFromJobLog(
      routeMetricLogLine({ outcome: 'failed', attempt_failures: 1 }),
      { platform: 'macos' },
    );

    updateMetricsBatch({
      repoRoot: repo,
      updates: [
        {
          reports: [],
          results: passed,
          run: { ...baseRun(), run_id: '1', conclusion: 'success' },
        },
        {
          reports: [],
          results: failed,
          run: {
            ...baseRun(),
            run_id: '2',
            completed_at: '2026-07-07T13:00:00.000Z',
            conclusion: 'failure',
          },
        },
      ],
    });

    const runs = readTable(path.join(repo, 'data', 'runs.csv'), HEADERS.runs);
    const results = readRouteResults({ repoRoot: repo });
    const stats = readTable(path.join(repo, 'data', 'route_stats.csv'), HEADERS.routeStats);
    assert.equal(runs.length, 2);
    assert.equal(results.length, 2);
    assert.deepEqual(pick(stats[0], ['full_runs', 'full_failed_runs', 'pass_rate', 'last_outcome']), {
      full_runs: '2',
      full_failed_runs: '1',
      pass_rate: '0.5000',
      last_outcome: 'failed',
    });
  });

  it('stores route results in UTC daily shards behind one read interface', () => {
    const repo = createTempRepo();
    const passed = extractRouteResultsFromJobLog(routeMetricLogLine({ outcome: 'passed' }), {
      platform: 'macos',
    });

    updateMetricsBatch({
      repoRoot: repo,
      updates: [
        {
          reports: [],
          results: passed,
          run: { ...baseRun(), run_id: 'day-one' },
        },
        {
          reports: [],
          results: passed,
          run: {
            ...baseRun(),
            run_id: 'day-two',
            started_at: '2026-07-08T00:30:00.000Z',
            completed_at: '2026-07-08T01:00:00.000Z',
          },
        },
      ],
    });

    assert.deepEqual(readdirSync(path.join(repo, 'data', 'route_results')), [
      '2026-07-07.csv',
      '2026-07-08.csv',
    ]);
    assert.equal(existsSync(path.join(repo, 'data', 'route_results.csv')), false);
    assert.deepEqual(
      readRouteResults({ repoRoot: repo }).map((row) => row.run_id),
      ['day-one', 'day-two'],
    );
  });

  it('keeps the complete legacy file authoritative until a shard migration finishes', () => {
    const repo = createTempRepo();
    const dataDir = path.join(repo, 'data');
    const legacyRow = { run_id: 'legacy', run_attempt: '1', platform: 'macos', route_id: 'legacy-route' };
    const partialRow = { run_id: 'partial', run_attempt: '1', platform: 'macos', route_id: 'partial-route' };
    mkdirSync(path.join(dataDir, 'route_results'), { recursive: true });
    writeFileSync(
      path.join(dataDir, 'route_results.csv'),
      stringifyCsv(HEADERS.routeResults, [legacyRow]),
    );
    writeFileSync(
      path.join(dataDir, 'route_results', '2026-07-07.csv'),
      stringifyCsv(HEADERS.routeResults, [partialRow]),
    );

    assert.deepEqual(readRouteResults({ repoRoot: repo }).map((row) => row.run_id), ['legacy']);
  });

  it('rewrites only the daily shard affected by an incremental run update', () => {
    const repo = createTempRepo();
    const passed = extractRouteResultsFromJobLog(routeMetricLogLine({ outcome: 'passed' }), {
      platform: 'macos',
    });
    const dayTwoRun = {
      ...baseRun(),
      run_id: 'day-two',
      started_at: '2026-07-08T00:30:00.000Z',
      completed_at: '2026-07-08T01:00:00.000Z',
    };

    updateMetricsBatch({
      repoRoot: repo,
      updates: [
        { reports: [], results: passed, run: { ...baseRun(), run_id: 'day-one' } },
        { reports: [], results: passed, run: dayTwoRun },
      ],
    });

    const failed = extractRouteResultsFromJobLog(
      routeMetricLogLine({ outcome: 'failed', attempt_failures: 1 }),
      { platform: 'macos' },
    );
    const summary = updateMetrics({ repoRoot: repo, reports: [], results: failed, run: dayTwoRun });

    assert.deepEqual(summary.routeResultFilesWritten, ['data/route_results/2026-07-08.csv']);
    assert.deepEqual(
      readRouteResults({ repoRoot: repo }).map((row) => `${row.run_id}:${row.outcome}`),
      ['day-one:passed', 'day-two:failed'],
    );
  });

  it('defers aggregate recomputation across backfill batches until explicitly requested', () => {
    const repo = createTempRepo();
    const passed = extractRouteResultsFromJobLog(routeMetricLogLine({ outcome: 'passed' }), {
      platform: 'macos',
    });

    updateMetricsBatch({
      repoRoot: repo,
      updates: [{ reports: [], results: passed, run: baseRun() }],
      recomputeAggregates: false,
    });

    assert.deepEqual(readTable(path.join(repo, 'data', 'route_stats.csv'), HEADERS.routeStats), []);
    recomputeAggregateTables({ repoRoot: repo });
    assert.equal(readTable(path.join(repo, 'data', 'route_stats.csv'), HEADERS.routeStats).length, 1);
  });

  it('preserves complete platform results when a rerun is partial or artifact-only', () => {
    const repo = createTempRepo();
    const macPassed = extractRouteResultsFromJobLog(routeMetricLogLine({ platform: 'macos' }), {
      platform: 'macos',
    });
    const windowsPassed = extractRouteResultsFromJobLog(
      routeMetricLogLine({ platform: 'windows' }),
      { platform: 'windows' },
    );

    updateMetrics({
      repoRoot: repo,
      reports: [],
      results: [...macPassed, ...windowsPassed],
      run: baseRun(),
    });

    const macFailed = extractRouteResultsFromJobLog(
      routeMetricLogLine({ platform: 'macos', outcome: 'failed', attempt_failures: 1 }),
      { platform: 'macos' },
    );
    updateMetrics({ repoRoot: repo, reports: [], results: macFailed, run: baseRun() });

    const report = writeReport(repo, 'electron-macos.json', sampleReport({ finalStatus: 'passed' }));
    updateMetrics({
      repoRoot: repo,
      reports: [{ platform: 'macos', path: report }],
      results: [],
      run: baseRun(),
    });

    const partialMac = extractRouteResultsFromJobLog(
      [
        '2026-07-07T14:26:08.1545630Z   1 failed',
        '2026-07-07T14:26:08.1546150Z     [electron] › tests/e2e/specs/chat-input.spec.ts:7:7 › composer behavior › sends with keyboard',
      ].join('\n'),
      { platform: 'macos' },
    );
    updateMetrics({ repoRoot: repo, reports: [], results: partialMac, run: baseRun() });

    const results = readRouteResults({ repoRoot: repo });
    assert.deepEqual(
      results.map((row) => pick(row, ['platform', 'outcome', 'data_source'])),
      [
        { platform: 'macos', outcome: 'failed', data_source: JOB_LOG_ROUTE_METRIC_SOURCE },
        { platform: 'windows', outcome: 'passed', data_source: JOB_LOG_ROUTE_METRIC_SOURCE },
      ],
    );
  });

  it('applies module tag overrides and current-run updates are idempotent', () => {
    const repo = createTempRepo();
    const routeId = 'tests/e2e/specs/chat-input.spec.ts :: composer behavior > sends with keyboard';
    mkdirSync(path.join(repo, 'config'), { recursive: true });
    writeFileSync(
      path.join(repo, 'config', 'route-module-overrides.csv'),
      stringifyCsv(HEADERS.overrides, [{ route_id: routeId, module_tags: 'chat;keyboard-shortcuts', note: 'manual' }]),
      'utf8',
    );
    const report = writeReport(repo, 'electron-macos.json', sampleReport({ finalStatus: 'passed' }));

    const update = () =>
      updateMetrics({
        repoRoot: repo,
        reports: [{ platform: 'macos', path: report }],
        run: baseRun(),
      });

    update();
    update();

    const routes = readTable(path.join(repo, 'data', 'routes.csv'), HEADERS.routes);
    const results = readRouteResults({ repoRoot: repo });

    assert.equal(routes.length, 1);
    assert.equal(routes[0].module_tags, 'chat;keyboard-shortcuts');
    assert.equal(results.length, 1);
  });
});

function pick(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, object[key]]));
}

function createTempRepo() {
  return mkdtempSync(path.join(os.tmpdir(), 'e2e-ci-metrics-test-'));
}

function writeReport(directory, filename, data) {
  const filePath = path.join(directory, filename);
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

function run(runId, runAttempt, completedAt) {
  return {
    run_id: runId,
    run_attempt: runAttempt,
    completed_at: completedAt,
  };
}

function result(runId, runAttempt, routeId, outcome, platform) {
  return {
    run_id: runId,
    run_attempt: runAttempt,
    route_id: routeId,
    platform,
    outcome,
    attempt_failures: outcome === 'passed' ? '0' : '1',
    error_signature: outcome === 'failed' ? 'Error: window failure' : '',
    data_source: JOB_LOG_ROUTE_METRIC_SOURCE,
  };
}

function baseRun() {
  return {
    run_id: '123',
    run_attempt: '1',
    run_number: '45',
    workflow: 'CI',
    branch: 'feature/e2e',
    sha: 'abcdef',
    event: 'pull_request',
    pr_number: '99',
    started_at: '2026-07-07T11:00:00.000Z',
    completed_at: '2026-07-07T12:00:00.000Z',
    conclusion: 'failure',
  };
}

function routeMetricLogLine(overrides = {}) {
  const payload = {
    schema_version: 1,
    platform: 'macos',
    project: 'electron',
    route_id: 'tests/e2e/specs/chat-input.spec.ts :: composer behavior > sends with keyboard',
    spec_file: 'tests/e2e/specs/chat-input.spec.ts',
    spec_basename: 'chat-input.spec.ts',
    title_path: 'composer behavior > sends with keyboard',
    outcome: 'passed',
    duration_ms: 33,
    retry_count: 0,
    attempt_failures: 0,
    error_signature: '',
    ...overrides,
  };
  const footerOutcome = payload.outcome === 'skipped' ? 'skipped' : payload.outcome;
  return [
    `2026-07-07T14:26:08.1548480Z E2E_ROUTE_METRIC ${JSON.stringify(payload)}`,
    `2026-07-07T14:26:08.1549480Z   1 ${footerOutcome}`,
  ].join('\n');
}

function sampleReport({ status = 'expected', finalStatus = 'passed', results } = {}) {
  const testResults = results ?? [{ status: finalStatus, retry: 0, duration: 33, errors: [] }];
  return {
    config: {
      projects: [{ id: 'electron', name: 'electron' }],
    },
    suites: [
      {
        title: 'tests/e2e/specs/chat-input.spec.ts',
        file: 'tests/e2e/specs/chat-input.spec.ts',
        suites: [
          {
            title: 'composer behavior',
            file: 'tests/e2e/specs/chat-input.spec.ts',
            specs: [
              {
                title: 'sends with keyboard',
                file: 'tests/e2e/specs/chat-input.spec.ts',
                tests: [
                  {
                    projectId: 'electron',
                    projectName: 'electron',
                    status,
                    results: testResults,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}
