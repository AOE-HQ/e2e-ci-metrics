import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { readTable, writeTable } from './csv-table.mjs';

export const ROUTE_RESULT_HEADERS = [
  'run_id',
  'run_attempt',
  'platform',
  'project',
  'route_id',
  'outcome',
  'duration_ms',
  'retry_count',
  'attempt_failures',
  'error_signature',
  'artifact_url',
  'data_source',
];

export function readRouteResults({ repoRoot, days }) {
  const legacy = legacyPath(repoRoot);
  if (existsSync(legacy)) {
    return readTable(legacy, ROUTE_RESULT_HEADERS);
  }
  const selectedDays = days ? new Set(days) : null;
  const shardFiles = listRouteResultShardFiles({ repoRoot }).filter(
    (filePath) => !selectedDays || selectedDays.has(path.basename(filePath, '.csv')),
  );
  if (shardFiles.length > 0) {
    return shardFiles.flatMap((filePath) => readTable(filePath, ROUTE_RESULT_HEADERS));
  }
  return [];
}

export function ensureRouteResultsSharded({ repoRoot, runs }) {
  const legacy = legacyPath(repoRoot);
  if (!existsSync(legacy)) {
    return [];
  }
  const rows = readTable(legacy, ROUTE_RESULT_HEADERS);
  return writeRouteResults({ repoRoot, rows, runs });
}

export function writeRouteResults({ repoRoot, rows, runs, days }) {
  const directory = shardDirectory(repoRoot);
  const runByKey = new Map(runs.map((run) => [runKey(run), run]));
  const byDay = new Map();
  const selectedDays = days ? new Set(days) : null;

  for (const row of rows) {
    const day = routeResultDay(runByKey.get(runKey(row)));
    if (selectedDays && !selectedDays.has(day)) {
      continue;
    }
    if (!byDay.has(day)) {
      byDay.set(day, []);
    }
    byDay.get(day).push(row);
  }

  if (!selectedDays) {
    rmSync(directory, { recursive: true, force: true });
  }
  const daysToWrite = selectedDays ?? new Set(byDay.keys());
  const writtenFiles = [];
  for (const day of [...daysToWrite].sort()) {
    const dayRows = byDay.get(day) ?? [];
    const filePath = path.join(directory, `${day}.csv`);
    if (dayRows.length === 0) {
      rmSync(filePath, { force: true });
      continue;
    }
    dayRows.sort(compareRows);
    writeTable(filePath, ROUTE_RESULT_HEADERS, dayRows);
    writtenFiles.push(`data/route_results/${day}.csv`);
  }
  rmSync(legacyPath(repoRoot), { force: true });
  return writtenFiles;
}

export function listRouteResultShardFiles({ repoRoot }) {
  const directory = shardDirectory(repoRoot);
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((fileName) => /^\d{4}-\d{2}-\d{2}\.csv$/.test(fileName) || fileName === 'unknown.csv')
    .sort()
    .map((fileName) => path.join(directory, fileName));
}

export function routeResultDay(run) {
  for (const value of [run?.started_at, run?.completed_at]) {
    const timestamp = new Date(value ?? '');
    if (!Number.isNaN(timestamp.getTime())) {
      return timestamp.toISOString().slice(0, 10);
    }
  }
  return 'unknown';
}

function compareRows(left, right) {
  return (
    runKey(left).localeCompare(runKey(right)) ||
    left.platform.localeCompare(right.platform) ||
    left.route_id.localeCompare(right.route_id)
  );
}

function runKey(row) {
  return `${row.run_id ?? ''}#${row.run_attempt ?? '1'}`;
}

function shardDirectory(repoRoot) {
  return path.join(repoRoot, 'data', 'route_results');
}

function legacyPath(repoRoot) {
  return path.join(repoRoot, 'data', 'route_results.csv');
}
