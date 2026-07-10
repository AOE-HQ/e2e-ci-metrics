import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PAGE_SIZE = 100;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export function listWorkflowRunsFromCheckpoint({
  repository,
  workflow,
  checkpoint,
  retries = 3,
  requestJson = ghApiJson,
}) {
  const checkpointRunId = String(checkpoint.processed_through.run_id);
  const endpoint = `repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs`;
  const discovered = [];
  let page = 1;
  let foundCheckpoint = false;

  while (!foundCheckpoint) {
    const response = withRetries(
      () =>
        requestJson(endpoint, {
          per_page: String(DEFAULT_PAGE_SIZE),
          page: String(page),
        }),
      retries,
    );
    const pageRuns = response.workflow_runs ?? [];
    if (pageRuns.length === 0) {
      break;
    }

    for (const rawRun of pageRuns) {
      const run = normalizeWorkflowRun(rawRun);
      discovered.push(run);
      if (run.run_id === checkpointRunId) {
        foundCheckpoint = true;
        break;
      }
    }
    page += 1;
  }

  if (!foundCheckpoint) {
    throw new Error(`Checkpoint run ${checkpointRunId} was not found in ${repository}/${workflow}.`);
  }

  return discovered.reverse();
}

export function planIncrementalSync({ checkpoint, runs, snapshotAt }) {
  const cursor = checkpoint.processed_through;
  const normalizedRuns = runs.map(normalizeWorkflowRun).sort(compareRuns);
  const checkpointIndex = normalizedRuns.findIndex((run) => run.run_id === String(cursor.run_id));
  if (checkpointIndex < 0) {
    throw new Error(`Checkpoint run ${cursor.run_id} is missing from the incremental run window.`);
  }

  const incrementalRuns = normalizedRuns.slice(checkpointIndex);
  const runsToSync = incrementalRuns.filter(
    (run) => run.status === 'completed' && isNewerThanCheckpoint(run, cursor),
  );
  let frontier = null;
  let blockedBy = null;

  for (const run of incrementalRuns) {
    if (!isAtOrAfterCheckpoint(run, cursor)) {
      continue;
    }
    if (run.status !== 'completed') {
      blockedBy = run;
      break;
    }
    frontier = run;
  }

  return {
    needsBackfill: runsToSync.length > 0,
    since: String(cursor.created_at),
    until: new Date(snapshotAt).toISOString(),
    runIdsToSync: runsToSync.map((run) => run.run_id),
    blockedBy,
    nextCheckpoint: frontier ? checkpointFromRun(checkpoint, frontier) : checkpoint,
  };
}

export function runHourlyUpdate({
  repository,
  workflow,
  repoRoot,
  checkpointPath,
  snapshotAt = new Date().toISOString(),
  retries = 3,
  dryRun = false,
  listRuns = listWorkflowRunsFromCheckpoint,
  runBackfill = executeBackfill,
}) {
  const checkpoint = readCheckpoint(checkpointPath, { repository, workflow });
  const runs = listRuns({ repository, workflow, checkpoint, retries });
  const plan = planIncrementalSync({ checkpoint, runs, snapshotAt });

  if (dryRun) {
    return { ...plan, checkpointUpdated: false, dryRun: true };
  }

  if (plan.needsBackfill) {
    runBackfill({
      repository,
      workflow,
      repoRoot,
      since: plan.since,
      until: plan.until,
      retries,
    });
  }

  const checkpointUpdated = JSON.stringify(plan.nextCheckpoint) !== JSON.stringify(checkpoint);
  if (checkpointUpdated) {
    writeCheckpoint(checkpointPath, plan.nextCheckpoint);
  }

  return { ...plan, checkpointUpdated, dryRun: false };
}

export function readCheckpoint(checkpointPath, { repository, workflow } = {}) {
  const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8').replace(/^\uFEFF/, ''));
  if (checkpoint.schema_version !== 1) {
    throw new Error(`Unsupported checkpoint schema version: ${checkpoint.schema_version}`);
  }
  if (repository && checkpoint.repository !== repository) {
    throw new Error(`Checkpoint repository ${checkpoint.repository} does not match ${repository}.`);
  }
  if (workflow && checkpoint.workflow !== workflow) {
    throw new Error(`Checkpoint workflow ${checkpoint.workflow} does not match ${workflow}.`);
  }
  validateProcessedThrough(checkpoint.processed_through);
  return checkpoint;
}

export function writeCheckpoint(checkpointPath, checkpoint) {
  mkdirSync(path.dirname(checkpointPath), { recursive: true });
  writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

function normalizeWorkflowRun(run) {
  return {
    run_id: String(run.run_id ?? run.id),
    run_number: Number(run.run_number),
    run_attempt: Number(run.run_attempt ?? 1),
    status: String(run.status ?? ''),
    conclusion: String(run.conclusion ?? ''),
    created_at: String(run.created_at ?? ''),
    completed_at: String(run.completed_at ?? run.updated_at ?? ''),
    url: String(run.url ?? run.html_url ?? ''),
  };
}

function compareRuns(left, right) {
  return left.run_number - right.run_number || left.run_attempt - right.run_attempt;
}

function isAtOrAfterCheckpoint(run, cursor) {
  return (
    run.run_number > Number(cursor.run_number) ||
    (run.run_id === String(cursor.run_id) && run.run_attempt >= Number(cursor.run_attempt))
  );
}

function isNewerThanCheckpoint(run, cursor) {
  return (
    run.run_number > Number(cursor.run_number) ||
    (run.run_id === String(cursor.run_id) && run.run_attempt > Number(cursor.run_attempt))
  );
}

function checkpointFromRun(checkpoint, run) {
  return {
    schema_version: 1,
    repository: checkpoint.repository,
    workflow: checkpoint.workflow,
    processed_through: {
      run_id: run.run_id,
      run_number: run.run_number,
      run_attempt: run.run_attempt,
      created_at: run.created_at,
      completed_at: run.completed_at,
    },
  };
}

function validateProcessedThrough(cursor) {
  if (!cursor || !String(cursor.run_id ?? '')) {
    throw new Error('Checkpoint is missing processed_through.run_id.');
  }
  if (!Number.isInteger(Number(cursor.run_number)) || Number(cursor.run_number) < 1) {
    throw new Error('Checkpoint processed_through.run_number must be a positive integer.');
  }
  if (!Number.isInteger(Number(cursor.run_attempt)) || Number(cursor.run_attempt) < 1) {
    throw new Error('Checkpoint processed_through.run_attempt must be a positive integer.');
  }
  for (const field of ['created_at', 'completed_at']) {
    if (Number.isNaN(new Date(cursor[field]).getTime())) {
      throw new Error(`Checkpoint processed_through.${field} must be an ISO timestamp.`);
    }
  }
}

function executeBackfill({ repository, workflow, repoRoot, since, until, retries }) {
  execFileSync(
    process.execPath,
    [
      path.join(moduleDirectory, 'backfill-history.mjs'),
      '--repo',
      repository,
      '--workflow',
      workflow,
      '--since',
      since,
      '--until',
      until,
      '--repo-root',
      repoRoot,
      '--retries',
      String(retries),
      '--quiet-skips',
    ],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    },
  );
}

function withRetries(operation, retries) {
  const attempts = Math.max(1, Number(retries) || 1);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function ghApiJson(endpoint, fields) {
  const args = ['api', '-X', 'GET', endpoint];
  for (const [key, value] of Object.entries(fields)) {
    args.push('-f', `${key}=${value}`);
  }
  return JSON.parse(
    execFileSync('gh', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
}
