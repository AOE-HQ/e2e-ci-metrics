// ABOUTME: 定义每日 E2E 历史回看的 attempt 展开与终态判定策略。

const ALWAYS_TERMINAL_SOURCES = new Set(['artifact_json', 'job_log_route_metric']);
const PRIOR_ATTEMPT_TERMINAL_SOURCES = new Set(['job_log_failure_summary']);

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

export function isTerminalSource(source, { isLatestAttempt = true } = {}) {
  return String(source ?? '')
    .split(';')
    .some(
      (item) =>
        ALWAYS_TERMINAL_SOURCES.has(item) ||
        (!isLatestAttempt && PRIOR_ATTEMPT_TERMINAL_SOURCES.has(item)),
    );
}
