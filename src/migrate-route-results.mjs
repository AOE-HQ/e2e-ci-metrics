#!/usr/bin/env node
import path from 'node:path';

import { HEADERS, readTable } from './metrics-core.mjs';
import { ensureRouteResultsSharded, listRouteResultShardFiles } from './route-results-store.mjs';

const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
const runs = readTable(path.join(repoRoot, 'data', 'runs.csv'), HEADERS.runs);
const writtenFiles = ensureRouteResultsSharded({ repoRoot, runs });
const shardCount = listRouteResultShardFiles({ repoRoot }).length;

console.log(`Route results migration complete: wrote=${writtenFiles.length}, shards=${shardCount}.`);
