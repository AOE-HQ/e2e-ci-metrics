import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  listWorkflowRunsFromCheckpoint,
  planIncrementalSync,
  runHourlyUpdate,
} from '../src/hourly-update-core.mjs';

const checkpoint = {
  schema_version: 1,
  repository: 'AOE-HQ/aoe-desktop',
  workflow: 'ci.yml',
  processed_through: {
    run_id: '100',
    run_number: 100,
    run_attempt: 1,
    created_at: '2026-07-10T08:00:00.000Z',
    completed_at: '2026-07-10T08:30:00.000Z',
  },
};
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('workflow run discovery includes the checkpoint and stops reading older pages', () => {
  const requestedPages = [];
  const pages = new Map([
    [1, [workflowRun(103), workflowRun(102)]],
    [2, [workflowRun(101), workflowRun(100), workflowRun(99)]],
    [3, [workflowRun(98)]],
  ]);

  const runs = listWorkflowRunsFromCheckpoint({
    repository: checkpoint.repository,
    workflow: checkpoint.workflow,
    checkpoint,
    requestJson(_endpoint, fields) {
      const page = Number(fields.page);
      requestedPages.push(page);
      return { workflow_runs: pages.get(page) ?? [] };
    },
  });

  assert.deepEqual(requestedPages, [1, 2]);
  assert.deepEqual(
    runs.map((run) => run.run_id),
    ['100', '101', '102', '103'],
  );
});

test('workflow run discovery retries transient page failures', () => {
  let attempts = 0;
  const runs = listWorkflowRunsFromCheckpoint({
    repository: checkpoint.repository,
    workflow: checkpoint.workflow,
    checkpoint,
    retries: 2,
    requestJson() {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('temporary API failure');
      }
      return { workflow_runs: [workflowRun(100)] };
    },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(runs.map((run) => run.run_id), ['100']);
});

test('completed runs advance the checkpoint while keeping the query boundary inclusive', () => {
  const snapshotAt = '2026-07-10T12:00:00.000Z';
  const plan = planIncrementalSync({
    checkpoint,
    snapshotAt,
    runs: [workflowRun(100), workflowRun(101), workflowRun(102)],
  });

  assert.equal(plan.needsBackfill, true);
  assert.equal(plan.since, checkpoint.processed_through.created_at);
  assert.equal(plan.until, snapshotAt);
  assert.deepEqual(plan.runIdsToSync, ['101', '102']);
  assert.equal(plan.nextCheckpoint.processed_through.run_id, '102');
  assert.equal(plan.nextCheckpoint.processed_through.run_number, 102);
});

test('an unfinished run blocks the checkpoint without blocking imports from later completed runs', () => {
  const plan = planIncrementalSync({
    checkpoint,
    snapshotAt: '2026-07-10T12:00:00.000Z',
    runs: [
      workflowRun(100),
      workflowRun(101, { status: 'in_progress', conclusion: null, updated_at: null }),
      workflowRun(102),
    ],
  });

  assert.equal(plan.needsBackfill, true);
  assert.deepEqual(plan.runIdsToSync, ['102']);
  assert.equal(plan.blockedBy.run_id, '101');
  assert.deepEqual(plan.nextCheckpoint, checkpoint);
});

test('a newer attempt of the checkpoint run is treated as new work', () => {
  const plan = planIncrementalSync({
    checkpoint,
    snapshotAt: '2026-07-10T12:00:00.000Z',
    runs: [workflowRun(100, { run_attempt: 2, updated_at: '2026-07-10T11:30:00.000Z' })],
  });

  assert.equal(plan.needsBackfill, true);
  assert.deepEqual(plan.runIdsToSync, ['100']);
  assert.equal(plan.nextCheckpoint.processed_through.run_attempt, 2);
  assert.equal(plan.nextCheckpoint.processed_through.completed_at, '2026-07-10T11:30:00.000Z');
});

test('the persisted checkpoint advances only after the inclusive backfill succeeds', () => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'e2e-ci-hourly-update-'));
  const checkpointPath = path.join(repoRoot, 'state', 'checkpoint.json');
  mkdirSync(path.dirname(checkpointPath), { recursive: true });
  writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  const backfills = [];

  try {
    const result = runHourlyUpdate({
      repository: checkpoint.repository,
      workflow: checkpoint.workflow,
      repoRoot,
      checkpointPath,
      snapshotAt: '2026-07-10T12:00:00.000Z',
      listRuns: () => [workflowRun(100), workflowRun(101)],
      runBackfill: (options) => backfills.push(options),
    });

    assert.equal(result.checkpointUpdated, true);
    assert.equal(backfills.length, 1);
    assert.equal(backfills[0].since, checkpoint.processed_through.created_at);
    assert.equal(backfills[0].until, '2026-07-10T12:00:00.000Z');
    const saved = JSON.parse(readFileSync(checkpointPath, 'utf8'));
    assert.equal(saved.processed_through.run_id, '101');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('a failed backfill leaves the persisted checkpoint unchanged', () => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'e2e-ci-hourly-update-failure-'));
  const checkpointPath = path.join(repoRoot, 'state', 'checkpoint.json');
  mkdirSync(path.dirname(checkpointPath), { recursive: true });
  const original = `${JSON.stringify(checkpoint, null, 2)}\n`;
  writeFileSync(checkpointPath, original);

  try {
    assert.throws(
      () =>
        runHourlyUpdate({
          repository: checkpoint.repository,
          workflow: checkpoint.workflow,
          repoRoot,
          checkpointPath,
          snapshotAt: '2026-07-10T12:00:00.000Z',
          listRuns: () => [workflowRun(100), workflowRun(101)],
          runBackfill: () => {
            throw new Error('temporary GitHub API failure');
          },
        }),
      /temporary GitHub API failure/,
    );
    assert.equal(readFileSync(checkpointPath, 'utf8'), original);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('the hourly workflow is a single serialized writer and explicitly redeploys Pages', () => {
  const workflow = readFileSync(path.join(projectRoot, '.github', 'workflows', 'hourly-metrics.yml'), 'utf8');

  assert.match(workflow, /cron: '17 \* \* \* \*'/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /group: e2e-ci-metrics-writer/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /secrets\.AOE_DESKTOP_READ_TOKEN/);
  assert.match(workflow, /--checkpoint state\/aoe-desktop-ci-checkpoint\.json/);
  assert.match(workflow, /state\/aoe-desktop-ci-checkpoint\.json/);
  assert.match(workflow, /gh workflow run pages\.yml/);
  assert.doesNotMatch(workflow, /^\s+push:/m);
});

function workflowRun(runNumber, overrides = {}) {
  const hour = String(runNumber - 92).padStart(2, '0');
  return {
    id: runNumber,
    run_number: runNumber,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
    created_at: `2026-07-10T${hour}:00:00.000Z`,
    updated_at: `2026-07-10T${hour}:30:00.000Z`,
    html_url: `https://github.com/AOE-HQ/aoe-desktop/actions/runs/${runNumber}`,
    ...overrides,
  };
}
