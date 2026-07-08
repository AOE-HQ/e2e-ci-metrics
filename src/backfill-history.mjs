#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverReports, updateMetrics } from './metrics-core.mjs';

const args = parseArgs(process.argv.slice(2));
const repo = required(args, 'repo');
const workflow = required(args, 'workflow');
const since = args.since ?? '1970-01-01';
const repoRoot = path.resolve(args['repo-root'] ?? process.cwd());
const limit = Number(args.limit ?? 100);

const runs = listRuns({ repo, workflow, since, limit });
console.log(`Found ${runs.length} historical workflow runs to inspect.`);

for (const run of runs) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), `e2e-ci-metrics-${run.databaseId}-`));
  try {
    downloadArtifacts({ repo, runId: run.databaseId, outputDir: tempDir });
    const reports = discoverReports(tempDir);
    if (reports.length === 0) {
      console.warn(`Run ${run.databaseId}: no E2E JSON artifacts found; skipped.`);
      continue;
    }

    updateMetrics({
      repoRoot,
      reports,
      run: {
        run_id: String(run.databaseId),
        run_attempt: String(run.attempt ?? 1),
        run_number: String(run.number ?? ''),
        workflow: run.workflowName ?? workflow,
        branch: run.headBranch ?? '',
        sha: run.headSha ?? '',
        event: run.event ?? '',
        pr_number: '',
        started_at: run.startedAt ?? '',
        completed_at: run.updatedAt ?? run.startedAt ?? '',
        conclusion: run.conclusion ?? '',
      },
      artifactUrl: run.url ?? '',
    });
    console.log(`Run ${run.databaseId}: imported ${reports.length} report(s).`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function listRuns({ repo, workflow, since, limit }) {
  const search = `repo:${repo} workflow:${workflow} created:>=${since}`;
  const output = execFileSync(
    'gh',
    [
      'run',
      'list',
      '--repo',
      repo,
      '--workflow',
      workflow,
      '--status',
      'completed',
      '--created',
      `>=${since}`,
      '--limit',
      String(limit),
      '--json',
      'databaseId,attempt,number,workflowName,headBranch,headSha,event,startedAt,updatedAt,conclusion,url',
    ],
    { encoding: 'utf8' },
  );
  const runs = JSON.parse(output);
  console.log(`Backfill query: ${search}`);
  return runs;
}

function downloadArtifacts({ repo, runId, outputDir }) {
  try {
    execFileSync('gh', ['run', 'download', String(runId), '--repo', repo, '--pattern', 'e2e-report-*', '--dir', outputDir], {
      stdio: 'inherit',
    });
  } catch {
    const entries = readdirSync(outputDir);
    if (entries.length === 0) {
      return;
    }
    throw new Error(`artifact download failed for run ${runId}`);
  }
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
    parsed[key] = !next || next.startsWith('--') ? true : next;
    if (parsed[key] !== true) {
      index += 1;
    }
  }
  return parsed;
}

function required(parsedArgs, key) {
  const value = parsedArgs[key];
  if (!value || value === true) {
    throw new Error(`Missing required --${key}`);
  }
  return value;
}
