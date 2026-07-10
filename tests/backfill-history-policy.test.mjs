// ABOUTME: 验证每日回看只扫描近期 run，并保留每次 workflow rerun attempt。

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';

import { expandWorkflowRunAttempts, isTerminalSource } from '../src/backfill-history-policy.mjs';

describe('backfill history policy', () => {
  it('expands every available attempt while reusing the latest run response', () => {
    const loadedAttempts = [];
    const runs = expandWorkflowRunAttempts(
      [{ databaseId: 42, attempt: 3, conclusion: 'success' }],
      ({ run, attempt }) => {
        loadedAttempts.push(attempt);
        return {
          ...run,
          attempt,
          conclusion: attempt === 1 ? 'failure' : 'success',
        };
      },
    );

    assert.deepEqual(loadedAttempts, [1, 2]);
    assert.deepEqual(
      runs.map((run) => ({
        attempt: run.attempt,
        conclusion: run.conclusion,
        isLatestAttempt: run.isLatestAttempt,
      })),
      [
        { attempt: 1, conclusion: 'failure', isLatestAttempt: false },
        { attempt: 2, conclusion: 'success', isLatestAttempt: false },
        { attempt: 3, conclusion: 'success', isLatestAttempt: true },
      ],
    );
  });

  it('retries only observations that can still improve on later daily summaries', () => {
    assert.equal(isTerminalSource('artifact_json'), true);
    assert.equal(isTerminalSource('job_log_route_metric'), true);
    assert.equal(isTerminalSource('job_log_failure_summary'), false);
    assert.equal(
      isTerminalSource('job_log_failure_summary', { isLatestAttempt: false }),
      true,
    );
    assert.equal(isTerminalSource('unavailable_job_log'), false);
    assert.equal(isTerminalSource('unavailable_job_log', { isLatestAttempt: false }), false);
    assert.equal(isTerminalSource('inspected_ci'), false);
  });

  it('uses run-scoped artifact and attempt-scoped job APIs', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src', 'backfill-history.mjs'), 'utf8');

    assert.doesNotMatch(source, /repos\/\$\{repo\}\/actions\/artifacts/);
    assert.match(source, /actions\/runs\/\$\{runId\}\/artifacts/);
    assert.match(source, /actions\/runs\/\$\{runId\}\/attempts\/\$\{attempt\}\/jobs/);
    assert.match(
      source,
      /isTerminalSource\(\s*existingSource,\s*\{ isLatestAttempt: run\.isLatestAttempt \}\s*\)/s,
    );
    assert.match(source, /refreshSource && !String\(existingSource/);
  });
});
