#!/usr/bin/env node
import path from 'node:path';
import { runHourlyUpdate } from './hourly-update-core.mjs';

try {
  const args = parseArgs(process.argv.slice(2));
  const repository = required(args, 'repo');
  const workflow = required(args, 'workflow');
  const repoRoot = path.resolve(args['repo-root'] ?? process.cwd());
  const checkpointPath = path.resolve(
    repoRoot,
    args.checkpoint ?? path.join('state', 'aoe-desktop-ci-checkpoint.json'),
  );

  const result = runHourlyUpdate({
    repository,
    workflow,
    repoRoot,
    checkpointPath,
    retries: Number(args.retries ?? 3),
    snapshotAt: args['snapshot-at'] ?? new Date().toISOString(),
    dryRun: Boolean(args['dry-run']),
  });

  if (result.needsBackfill) {
    console.log(
      `${result.dryRun ? 'Would update' : 'Updated'} ${result.runIdsToSync.length} completed run(s) from checkpoint ${result.since}.`,
    );
  } else {
    console.log('No completed workflow runs were found after the stored checkpoint.');
  }

  if (result.blockedBy) {
    const reason = result.blockedBy.block_reason
      ? result.blockedBy.block_reason
      : `${result.blockedBy.status}; waiting for completion`;
    console.log(`Checkpoint remains before run #${result.blockedBy.run_number}: ${reason}.`);
  } else if (result.checkpointUpdated) {
    const cursor = result.nextCheckpoint.processed_through;
    console.log(`Checkpoint advanced to run #${cursor.run_number} (${cursor.run_id}, attempt ${cursor.run_attempt}).`);
  }
} catch (error) {
  console.error(`Hourly metrics update failed: ${error.message}`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    const value = next && !next.startsWith('--') ? next : true;
    parsed[key] = value;
    if (value !== true) {
      index += 1;
    }
  }
  return parsed;
}

function required(args, key) {
  const value = args[key];
  if (!value || value === true) {
    throw new Error(`Missing required --${key}`);
  }
  return String(value);
}
