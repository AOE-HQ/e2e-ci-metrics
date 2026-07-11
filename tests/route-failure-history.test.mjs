import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRouteFailureHistory } from '../src/route-failure-history.mjs';

test('builds deterministic failed-commit history grouped by route, commit, run, and platform', () => {
  const generatedAt = '2026-07-10T12:00:00Z';
  const runs = [
    run('run-4', '1', '', '2026-07-01T00:00:00Z'),
    run('run-2', '2', 'shared-sha', '2026-07-04T00:00:00Z', { prNumber: '202' }),
    run('run-a', '1', 'alpha-sha', '2026-07-05T00:00:00Z'),
    run('run-3', '1', '', '2026-07-03T00:00:00Z'),
    run('run-1', '1', 'shared-sha', '2026-07-02T00:00:00Z', { prNumber: '101' }),
  ];
  const routeResults = [
    result('run-1', '1', 'zeta.spec.ts :: Zeta route', 'windows', 'failed', {
      artifactUrl: 'https://example.test/run-1/windows',
      error: 'Error: windows failure',
    }),
    result('run-a', '1', 'alpha.spec.ts :: Alpha route', 'macos', 'failed', {
      artifactUrl: 'https://example.test/run-a/macos',
      error: 'Error: alpha failure',
    }),
    result('run-1', '1', 'zeta.spec.ts :: Zeta route', 'macos', 'failed', {
      artifactUrl: 'https://example.test/run-1/macos',
      error: 'Error: macOS failure',
    }),
    result('run-2', '2', 'zeta.spec.ts :: Zeta route', 'macos', 'failed', {
      artifactUrl: 'https://example.test/run-2/macos',
      error: 'Error: newer failure',
    }),
    result('run-3', '1', 'zeta.spec.ts :: Zeta route', 'windows', 'failed'),
    result('run-4', '1', 'zeta.spec.ts :: Zeta route', 'macos', 'failed'),
    result('run-2', '2', 'ignored.spec.ts :: Passing route', 'windows', 'passed'),
    result('run-2', '2', 'ignored.spec.ts :: Legacy artifact route', 'windows', 'failed', {
      dataSource: 'artifact_json',
    }),
  ];

  const history = JSON.parse(
    JSON.stringify(buildRouteFailureHistory({ runs, routeResults, generatedAt })),
  );

  assert.deepEqual(history, {
    generated_at: generatedAt,
    routes: [
      {
        route_id: 'alpha.spec.ts :: Alpha route',
        failures: [
          {
            sha: 'alpha-sha',
            completed_at: '2026-07-05T00:00:00Z',
            runs: [
              {
                run_id: 'run-a',
                attempt: '1',
                run_number: 'number-run-a',
                completed_at: '2026-07-05T00:00:00Z',
                conclusion: 'failure',
                branch: 'branch-run-a',
                event: 'pull_request',
                pr_number: '',
                platforms: [
                  {
                    platform: 'macos',
                    artifact_url: 'https://example.test/run-a/macos',
                    error_signature: 'Error: alpha failure',
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        route_id: 'zeta.spec.ts :: Zeta route',
        failures: [
          {
            sha: 'shared-sha',
            completed_at: '2026-07-04T00:00:00Z',
            runs: [
              {
                run_id: 'run-2',
                attempt: '2',
                run_number: 'number-run-2',
                completed_at: '2026-07-04T00:00:00Z',
                conclusion: 'failure',
                branch: 'branch-run-2',
                event: 'pull_request',
                pr_number: '202',
                platforms: [
                  {
                    platform: 'macos',
                    artifact_url: 'https://example.test/run-2/macos',
                    error_signature: 'Error: newer failure',
                  },
                ],
              },
              {
                run_id: 'run-1',
                attempt: '1',
                run_number: 'number-run-1',
                completed_at: '2026-07-02T00:00:00Z',
                conclusion: 'failure',
                branch: 'branch-run-1',
                event: 'pull_request',
                pr_number: '101',
                platforms: [
                  {
                    platform: 'macos',
                    artifact_url: 'https://example.test/run-1/macos',
                    error_signature: 'Error: macOS failure',
                  },
                  {
                    platform: 'windows',
                    artifact_url: 'https://example.test/run-1/windows',
                    error_signature: 'Error: windows failure',
                  },
                ],
              },
            ],
          },
          {
            sha: '',
            completed_at: '2026-07-03T00:00:00Z',
            runs: [
              {
                run_id: 'run-3',
                attempt: '1',
                run_number: 'number-run-3',
                completed_at: '2026-07-03T00:00:00Z',
                conclusion: 'failure',
                branch: 'branch-run-3',
                event: 'pull_request',
                pr_number: '',
                platforms: [{ platform: 'windows', artifact_url: '', error_signature: '' }],
              },
            ],
          },
          {
            sha: '',
            completed_at: '2026-07-01T00:00:00Z',
            runs: [
              {
                run_id: 'run-4',
                attempt: '1',
                run_number: 'number-run-4',
                completed_at: '2026-07-01T00:00:00Z',
                conclusion: 'failure',
                branch: 'branch-run-4',
                event: 'pull_request',
                pr_number: '',
                platforms: [{ platform: 'macos', artifact_url: '', error_signature: '' }],
              },
            ],
          },
        ],
      },
    ],
  });
});

function run(runId, attempt, sha, completedAt, { prNumber = '' } = {}) {
  return {
    run_id: runId,
    run_attempt: attempt,
    run_number: `number-${runId}`,
    branch: `branch-${runId}`,
    sha,
    event: 'pull_request',
    pr_number: prNumber,
    completed_at: completedAt,
    conclusion: 'failure',
  };
}

function result(
  runId,
  attempt,
  routeId,
  platform,
  outcome,
  { artifactUrl = '', error = '', dataSource = 'job_log_failure_summary' } = {},
) {
  return {
    run_id: runId,
    run_attempt: attempt,
    route_id: routeId,
    platform,
    outcome,
    artifact_url: artifactUrl,
    error_signature: error,
    data_source: dataSource,
  };
}
