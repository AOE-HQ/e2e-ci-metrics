// ABOUTME: 定义每日 E2E 历史回看的 attempt 展开与终态判定策略。

const COMPLETE_LOG_SOURCE = 'job_log_route_metric';
const PRIOR_ATTEMPT_TERMINAL_SOURCE = 'job_log_failure_summary';

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
  const sources = String(source ?? '').split(';').filter(Boolean);
  if (sources.length === 1 && sources[0] === COMPLETE_LOG_SOURCE) {
    return true;
  }
  return !isLatestAttempt && sources.includes(PRIOR_ATTEMPT_TERMINAL_SOURCE);
}
