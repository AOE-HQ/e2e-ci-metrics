const FAILURE_HISTORY_SOURCES = new Set(['job_log_route_metric', 'job_log_failure_summary']);

export function buildRouteFailureHistory({ runs = [], routeResults = [], generatedAt = '' } = {}) {
  const runByKey = new Map(runs.map((run) => [runKey(run), run]));
  const routeGroups = new Map();

  for (const result of routeResults) {
    if (result.outcome !== 'failed' || !FAILURE_HISTORY_SOURCES.has(result.data_source)) {
      continue;
    }

    const routeId = text(result.route_id);
    const resultRunKey = runKey(result);
    const run = runByKey.get(resultRunKey) ?? {};
    const sha = text(run.sha);
    const failureKey = sha ? `sha:${sha}` : `run:${resultRunKey}`;
    const failures = routeGroups.get(routeId) ?? new Map();
    const failure = failures.get(failureKey) ?? {
      sha,
      sort_key: failureKey,
      runs: new Map(),
    };
    const failureRun = failure.runs.get(resultRunKey) ?? buildRun(run, result);
    const platform = text(result.platform);
    const existingPlatform = failureRun.platforms.get(platform);

    failureRun.platforms.set(platform, {
      platform,
      artifact_url: preferredText(existingPlatform?.artifact_url, result.artifact_url),
      error_signature: preferredText(existingPlatform?.error_signature, result.error_signature),
    });
    failure.runs.set(resultRunKey, failureRun);
    failures.set(failureKey, failure);
    routeGroups.set(routeId, failures);
  }

  return {
    generated_at: text(generatedAt),
    routes: [...routeGroups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([routeId, failures]) => ({
        route_id: routeId,
        failures: [...failures.values()]
          .map(finalizeFailure)
          .sort(compareFailures)
          .map(({ sort_key: _sortKey, ...failure }) => failure),
      })),
  };
}

function buildRun(run, result) {
  return {
    run_id: text(run.run_id ?? result.run_id),
    attempt: text(run.run_attempt || run.attempt || result.run_attempt || result.attempt || '1'),
    run_number: text(run.run_number),
    completed_at: text(run.completed_at),
    conclusion: text(run.conclusion),
    branch: text(run.branch),
    event: text(run.event),
    pr_number: text(run.pr_number),
    platforms: new Map(),
  };
}

function finalizeFailure(failure) {
  const runs = [...failure.runs.values()]
    .map((run) => ({
      ...run,
      platforms: [...run.platforms.values()].sort((left, right) =>
        left.platform.localeCompare(right.platform),
      ),
    }))
    .sort(compareRuns);

  return {
    sha: failure.sha,
    completed_at: runs[0]?.completed_at ?? '',
    runs,
    sort_key: failure.sort_key,
  };
}

function compareFailures(left, right) {
  return (
    compareCompletedAt(left.completed_at, right.completed_at) ||
    left.sha.localeCompare(right.sha) ||
    left.sort_key.localeCompare(right.sort_key)
  );
}

function compareRuns(left, right) {
  return (
    compareCompletedAt(left.completed_at, right.completed_at) ||
    left.run_id.localeCompare(right.run_id) ||
    left.attempt.localeCompare(right.attempt)
  );
}

function compareCompletedAt(left, right) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) {
    return Number.isFinite(rightTime) ? 1 : -1;
  }
  return right.localeCompare(left);
}

function preferredText(current, candidate) {
  const values = [text(current), text(candidate)].filter(Boolean).sort((left, right) => left.localeCompare(right));
  return values[0] ?? '';
}

function runKey(row) {
  return `${text(row.run_id)}#${text(row.run_attempt || row.attempt || '1')}`;
}

function text(value) {
  return String(value ?? '');
}
