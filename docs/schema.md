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

## `data/route_results.csv`

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

## `data/route_stats.csv`

| Column | Description |
| --- | --- |
| `route_id` | Stable route id. |
| `module_tags` | Semicolon-separated product module tags. |
| `total_runs` | Count of non-skipped route result rows. |
| `failed_runs` | Count of final failed route result rows. |
| `flaky_runs` | Count of retry-recovered route result rows. |
| `attempt_failures` | Sum of raw failed attempts. |
| `pass_rate` | `(total_runs - failed_runs) / total_runs`, four decimals. |
| `failed_runs_macos` | Final failed result count on macOS. |
| `failed_runs_windows` | Final failed result count on Windows. |
| `last_outcome` | Latest outcome by run completion time. |
| `last_failed_at` | Latest completion time where the route finally failed. |
| `top_error_signature` | Most frequent non-empty error signature. |

## `data/route_platform_stats.csv`

| Column | Description |
| --- | --- |
| `route_id` | Stable route id. |
| `platform` | `macos` or `windows`. |
| `module_tags` | Semicolon-separated product module tags. |
| `total_runs` | Count of non-skipped route result rows for this route on this platform. |
| `failed_runs` | Count of final failed route result rows for this route on this platform. |
| `flaky_runs` | Count of retry-recovered route result rows for this route on this platform. |
| `attempt_failures` | Sum of raw failed attempts for this route on this platform. |
| `pass_rate` | `(total_runs - failed_runs) / total_runs`, four decimals. |
| `last_outcome` | Latest outcome by run completion time for this route on this platform. |
| `last_failed_at` | Latest completion time where this route finally failed on this platform. |
| `top_error_signature` | Most frequent non-empty error signature for this route on this platform. |

## `config/route-module-overrides.csv`

| Column | Description |
| --- | --- |
| `route_id` | Stable route id. |
| `module_tags` | Semicolon-separated product module tags. |
| `note` | Human explanation for the override. |
