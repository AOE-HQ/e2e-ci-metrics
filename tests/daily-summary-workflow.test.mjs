// ABOUTME: 约束 E2E 指标只由统计仓库每日批量拉取并汇总一次。

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";

describe("daily summary workflow contract", () => {
  it("runs once per day and supports an explicit recovery start time", () => {
    const source = readWorkflow();

    assert.match(
      source,
      /schedule:\s*\r?\n\s*- cron: ['"]\d+ \d+ \* \* \*['"]/,
    );
    assert.match(source, /workflow_dispatch:/);
    assert.match(source, /since:/);
    assert.match(source, /group: e2e-metrics-daily-summary/);
    assert.match(source, /cancel-in-progress: false/);
  });

  it("reads recent AoE Desktop runs and creates at most one data commit", () => {
    const source = readWorkflow();

    assert.match(source, /AOE_DESKTOP_READ_TOKEN/);
    assert.match(source, /pnpm backfill --/);
    assert.match(source, /--repo AOE-HQ\/aoe-desktop/);
    assert.match(source, /--workflow ci\.yml/);
    assert.match(source, /--since/);
    assert.match(source, /git diff --quiet -- data/);
    assert.match(source, /git add -- data/);
    assert.match(source, /git commit/);
    assert.match(source, /git push/);
  });
});

function readWorkflow() {
  const workflowPath = path.resolve(
    process.cwd(),
    ".github",
    "workflows",
    "daily-summary.yml",
  );
  return readFileSync(workflowPath, "utf8");
}
