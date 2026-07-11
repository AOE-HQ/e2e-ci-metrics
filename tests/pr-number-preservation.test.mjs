import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HEADERS, readTable, updateMetricsBatch } from '../src/metrics-core.mjs';

test('keeps a known PR number when a later refresh omits it', () => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'e2e-ci-pr-preservation-'));
  try {
    updateMetricsBatch({
      repoRoot,
      updates: [{ run: run({ prNumber: '1709' }), results: [] }],
    });
    updateMetricsBatch({
      repoRoot,
      updates: [{ run: run({ prNumber: '' }), results: [] }],
    });

    const runs = readTable(path.join(repoRoot, 'data', 'runs.csv'), HEADERS.runs);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].pr_number, '1709');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

function run({ prNumber }) {
  return {
    run_id: '28524637730',
    run_attempt: '1',
    run_number: '4682',
    workflow: 'CI',
    branch: 'fix/20260623-0556',
    sha: 'ad66282eb2c881f29a88ae58c6225429e6754c57',
    event: 'pull_request',
    pr_number: prNumber,
    started_at: '2026-07-01T14:23:19Z',
    completed_at: '2026-07-01T16:09:41Z',
    conclusion: 'failure',
    data_source: 'job_log_failure_summary',
  };
}
