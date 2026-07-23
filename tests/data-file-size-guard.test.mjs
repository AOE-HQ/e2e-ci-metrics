import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';

import { findOversizedFiles } from '../src/check-data-file-sizes.mjs';

test('data file size guard reports only files above the configured threshold', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'e2e-ci-data-size-'));
  mkdirSync(path.join(root, 'nested'), { recursive: true });
  writeFileSync(path.join(root, 'small.csv'), '1234');
  writeFileSync(path.join(root, 'nested', 'large.csv'), '123456');

  try {
    assert.deepEqual(findOversizedFiles({ root, maxBytes: 5 }), [
      { path: 'nested/large.csv', sizeBytes: 6 },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
