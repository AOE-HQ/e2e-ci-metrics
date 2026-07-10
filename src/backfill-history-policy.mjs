// ABOUTME: 定义每日 E2E 历史回看的 attempt 展开与终态判定策略。

const TERMINAL_SOURCES = new Set(['artifact_json']);

export function expandWorkflowRunAttempts(latestRuns, loadPriorAttempt) {
  const expanded = [];

  for (const latestRun of latestRuns) {
    const latestAttempt = Math.max(1, Number(latestRun.attempt ?? 1));
    for (let attempt = 1; attempt <= latestAttempt; attempt += 1) {
      const isLatestAttempt = attempt === latestAttempt;
      const run = isLatestAttempt ? latestRun : loadPriorAttempt({ run: latestRun, attempt });
      if (!run) {
        continue;
      }
      expanded.push({ ...run, attempt, isLatestAttempt });
    }
  }

  return expanded;
}

export function isTerminalSource(source) {
  return String(source ?? '')
    .split(';')
    .some((item) => TERMINAL_SOURCES.has(item));
}
