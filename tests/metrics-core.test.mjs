import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {
  HEADERS,
  JOB_LOG_FAILURE_SOURCE,
  extractRouteResultsFromJobLog,
  extractRouteResultsFromReport,
  readTable,
  stringifyCsv,
  updateMetrics,
} from '../src/metrics-core.mjs';

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

  it('aggregates platform failures, flaky runs, and raw attempt failures', () => {
    const repo = createTempRepo();
    const macosReport = writeReport(
      repo,
      'electron-macos.json',
      sampleReport({
        status: 'flaky',
        results: [
          { status: 'failed', retry: 0, duration: 10, errors: [{ message: 'Error: first attempt failed' }] },
          { status: 'passed', retry: 1, duration: 12, errors: [] },
        ],
      }),
    );
    const windowsReport = writeReport(
      repo,
      'electron-windows.json',
      sampleReport({
        status: 'unexpected',
        results: [{ status: 'failed', retry: 0, duration: 20, errors: [{ message: 'Error: windows failed' }] }],
      }),
    );

    updateMetrics({
      repoRoot: repo,
      reports: [
        { platform: 'macos', path: macosReport },
        { platform: 'windows', path: windowsReport },
      ],
      run: baseRun(),
      artifactUrl: 'https://github.com/AOE-HQ/aoe-desktop/actions/runs/123',
    });

    const results = readTable(path.join(repo, 'data', 'route_results.csv'), HEADERS.routeResults);
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
        log_signal_runs: '0',
        log_failed_runs: '0',
        log_flaky_runs: '0',
        failed_runs: '1',
        flaky_runs: '1',
        attempt_failures: '2',
        pass_rate: '0.5000',
        failed_runs_macos: '0',
        failed_runs_windows: '1',
        last_outcome: 'failed',
        last_failed_at: '2026-07-07T12:00:00.000Z',
        top_error_signature: 'Error: first attempt failed',
      },
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
          log_signal_runs: '0',
          log_failed_runs: '0',
          log_flaky_runs: '0',
          failed_runs: '0',
          flaky_runs: '1',
          attempt_failures: '1',
          pass_rate: '1.0000',
          last_outcome: 'flaky',
        },
        {
          platform: 'windows',
          total_runs: '1',
          full_runs: '1',
          full_failed_runs: '1',
          full_flaky_runs: '0',
          log_signal_runs: '0',
          log_failed_runs: '0',
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
    const results = readTable(path.join(repo, 'data', 'route_results.csv'), HEADERS.routeResults);

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
