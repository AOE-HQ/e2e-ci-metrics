# CSV Schema

## `data/routes.csv`

| Column | Description |
| --- | --- |
| `route_id` | Stable route id: `spec_file :: title_path`. |
| `spec_file` | Full Playwright spec file path, normalized to `/`. |
| `spec_basename` | Spec file basename. |
| `title_path` | Full Playwright suite/test title path joined with ` > `. |
| `module_tags` | Semicolon-separated product module tags. |
| `first_seen_at` | Earliest CI completion time where this route appeared. |
| `last_seen_at` | Latest CI completion time where this route appeared. |
| `status` | `active` for currently observed routes. |

## `data/runs.csv`

| Column | Description |
| --- | --- |
| `run_id` | GitHub Actions run id. |
| `run_attempt` | GitHub Actions run attempt. |
| `run_number` | GitHub Actions run number. |
| `workflow` | Workflow name. |
| `branch` | Source branch or ref name. |
| `sha` | Head SHA. |
| `event` | GitHub event name. |
| `pr_number` | Pull request number when available. |
| `started_at` | Run start timestamp when available. |
| `completed_at` | Run completion timestamp. |
| `conclusion` | Overall test conclusion as reported by AoE Desktop CI. |
| `data_source` | Semicolon-separated metric sources used for this run: `job_log_route_metric` for footer-verified full log outcomes, `job_log_failure_summary` for legacy partial log signals, `inspected_ci`, or `unavailable_job_log`. `artifact_json` is retained only as a legacy route-catalog marker. |

## `data/route_results/YYYY-MM-DD.csv`

Route-result rows are partitioned by the UTC date of the corresponding run's
`started_at` timestamp. Every shard has the same columns. The dashboard
publishes `data/route_results/index.json` as the shard manifest.

| Column | Description |
| --- | --- |
| `run_id` | GitHub Actions run id. |
| `run_attempt` | GitHub Actions run attempt. |
| `platform` | `macos` or `windows`. |
| `project` | Playwright project, currently `electron`. |
| `route_id` | Stable route id. |
| `outcome` | `passed`, `failed`, `flaky`, or `skipped`. |
| `duration_ms` | Sum of Playwright attempt durations. |
| `retry_count` | Highest retry index observed for the test. |
| `attempt_failures` | Number of failed/timed-out/interrupted attempts. |
| `error_signature` | Normalized first error line when available. |
| `artifact_url` | GitHub Actions run URL or artifact URL. |
| `data_source` | `job_log_route_metric` for full route observations parsed from standard Playwright list-reporter rows and verified against footer totals, `job_log_failure_summary` for legacy failure-only log recovery, or `artifact_json` for legacy Playwright JSON rows kept only for route discovery. |

## `data/route_stats.csv`

| Column | Description |
| --- | --- |
| `route_id` | Stable route id. |
| `module_tags` | Semicolon-separated product module tags. |
| `total_runs` | Count of non-skipped route result rows derived from GitHub job logs. Legacy artifact rows are excluded. |
| `full_runs` | Count of non-skipped full route observations from `job_log_route_metric`. This is the denominator for `pass_rate`. |
| `full_failed_runs` | Count of final failed full route observations from `job_log_route_metric`. |
| `full_flaky_runs` | Count of retry-recovered flaky full route observations from `job_log_route_metric`. |
| `log_signal_runs` | Count of non-skipped rows recovered from GitHub job logs, including full JSONL route metrics and legacy failure-only summaries. |
| `log_failed_runs` | Count of final failed rows recovered from GitHub job logs. |
| `log_flaky_runs` | Count of retry-recovered flaky rows recovered from GitHub job logs. |
| `failed_runs` | Count of final failed route result rows, including log-recovered failures. |
| `flaky_runs` | Count of retry-recovered route result rows, including log-recovered flaky signals. |
| `attempt_failures` | Sum of raw failed attempts. |
| `pass_rate` | Clean success rate from `job_log_route_metric` rows only: `passed / (passed + flaky + failed)`, four decimals; blank when no full log observation exists. |
| `failed_runs_macos` | Final failed result count on macOS. |
| `failed_runs_windows` | Final failed result count on Windows. |
| `last_outcome` | Latest log-derived outcome by run completion time. |
| `last_failed_at` | Latest completion time where the route finally failed. |
| `top_error_signature` | Most frequent non-empty error signature. |

## `data/route_platform_stats.csv`

| Column | Description |
| --- | --- |
| `route_id` | Stable route id. |
| `platform` | `macos` or `windows`. |
| `module_tags` | Semicolon-separated product module tags. |
| `total_runs` | Count of non-skipped log-derived route result rows for this route on this platform. Legacy artifact rows are excluded. |
| `full_runs` | Count of non-skipped full route observations from `job_log_route_metric` for this route on this platform. |
| `full_failed_runs` | Count of final failed full route observations from `job_log_route_metric` for this route on this platform. |
| `full_flaky_runs` | Count of retry-recovered flaky full route observations from `job_log_route_metric` for this route on this platform. |
| `log_signal_runs` | Count of non-skipped rows recovered from GitHub job logs for this route on this platform. |
| `log_failed_runs` | Count of final failed rows recovered from GitHub job logs for this route on this platform. |
| `log_flaky_runs` | Count of retry-recovered flaky rows recovered from GitHub job logs for this route on this platform. |
| `failed_runs` | Count of final failed route result rows for this route on this platform, including log-recovered failures. |
| `flaky_runs` | Count of retry-recovered route result rows for this route on this platform, including log-recovered flaky signals. |
| `attempt_failures` | Sum of raw failed attempts for this route on this platform. |
| `pass_rate` | Clean success rate from `job_log_route_metric` rows only: `passed / (passed + flaky + failed)`, four decimals; blank when no full log observation exists. |
| `last_outcome` | Latest log-derived outcome by run completion time for this route on this platform. |
| `last_failed_at` | Latest completion time where this route finally failed on this platform. |
| `top_error_signature` | Most frequent non-empty error signature for this route on this platform. |

## `config/route-module-overrides.csv`

| Column | Description |
| --- | --- |
| `route_id` | Stable route id. |
| `module_tags` | Semicolon-separated product module tags. |
| `note` | Human explanation for the override. |
