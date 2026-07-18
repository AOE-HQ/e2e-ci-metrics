// ABOUTME: 约束 E2E 指标只由统计仓库每日批量拉取并汇总一次。

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';

describe('daily summary workflow contract', () => {
  it('runs once per day and supports an explicit recovery start time', () => {
    const source = readWorkflow();

    assert.match(source, /schedule:\s*\r?\n\s*- cron: ['"]\d+ \d+ \* \* \*['"]/);
    assert.match(source, /workflow_dispatch:/);
    assert.match(source, /since:/);
    assert.match(source, /group: e2e-ci-metrics-writer/);
    assert.match(source, /cancel-in-progress: false/);
    assert.match(source, /if: github\.ref == ['"]refs\/heads\/main['"]/);
    assert.match(source, /ref: main/);
  });

  it('reads recent AoE Desktop runs and creates at most one data commit', () => {
    const source = readWorkflow();

    assert.match(source, /AOE_DESKTOP_READ_TOKEN/);
    assert.equal((source.match(/pnpm backfill --/g) ?? []).length, 1);
    assert.match(source, /--repo AOE-HQ\/aoe-desktop/);
    assert.match(source, /--workflow ci\.yml/);
    assert.match(source, /--since/);
    assert.match(source, /check-data-file-sizes\.mjs --root data --max-mib 95/);
    assert.match(source, /git diff --quiet -- data/);
    assert.match(source, /git add -- data/);
    assert.equal((source.match(/git commit/g) ?? []).length, 1);
    assert.match(source, /git push origin HEAD:main/);

    const backfillIndex = source.indexOf('pnpm backfill --');
    const sizeGuardIndex = source.indexOf('check-data-file-sizes.mjs');
    const diffIndex = source.indexOf('git diff --quiet -- data');
    const commitIndex = source.indexOf('git commit');
    const pushIndex = source.indexOf('git push origin HEAD:main');
    assert.ok(backfillIndex < sizeGuardIndex);
    assert.ok(sizeGuardIndex < diffIndex);
    assert.ok(diffIndex < commitIndex);
    assert.ok(commitIndex < pushIndex);
  });
});

function readWorkflow() {
  const workflowPath = path.resolve(process.cwd(), '.github', 'workflows', 'daily-summary.yml');
  return readFileSync(workflowPath, 'utf8');
}
