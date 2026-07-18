#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function findOversizedFiles({ root, maxBytes }) {
  const absoluteRoot = path.resolve(root);
  const oversized = [];
  walk(absoluteRoot);
  return oversized.sort((left, right) => left.path.localeCompare(right.path));

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const sizeBytes = statSync(absolutePath).size;
      if (sizeBytes > maxBytes) {
        oversized.push({
          path: path.relative(absoluteRoot, absolutePath).split(path.sep).join('/'),
          sizeBytes,
        });
      }
    }
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root ?? 'data');
  const maxMiB = Number(args['max-mib'] ?? 95);
  if (!Number.isFinite(maxMiB) || maxMiB <= 0) {
    console.error(`Invalid --max-mib value: ${args['max-mib']}`);
    process.exitCode = 1;
  } else {
    const maxBytes = maxMiB * 1024 * 1024;
    const oversized = findOversizedFiles({ root, maxBytes });
    if (oversized.length > 0) {
      for (const file of oversized) {
        console.error(`${file.path}: ${(file.sizeBytes / 1024 / 1024).toFixed(2)} MiB exceeds ${maxMiB} MiB`);
      }
      process.exitCode = 1;
    } else {
      console.log(`All files under ${root} are at or below ${maxMiB} MiB.`);
    }
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
    parsed[key] = next && !next.startsWith('--') ? next : true;
    if (parsed[key] !== true) {
      index += 1;
    }
  }
  return parsed;
}
