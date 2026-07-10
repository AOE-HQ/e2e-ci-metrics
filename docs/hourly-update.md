# Hourly metrics update

`.github/workflows/hourly-metrics.yml` checks AoE Desktop CI every hour at
minute 17. It reads `state/aoe-desktop-ci-checkpoint.json`, imports completed
runs from that run onward, verifies the generated metrics, and commits the CSV
files and checkpoint together.

The checkpoint contains `run_id`, `run_number`, and `run_attempt`. Its
`created_at` value is only the inclusive GitHub query boundary; time alone is
not treated as the cursor. If an earlier run is still queued or in progress,
later completed runs may be imported, but the checkpoint does not advance past
the unfinished run. The next hourly update therefore sees that boundary again.
After backfill exits, the updater also checks `data/runs.csv`: only a complete
`job_log_route_metric` observation or an explicitly permanent
`unavailable_job_log` result can advance the checkpoint. Artifact-only and
legacy partial rows are retried through the log collector and remain a barrier
until a complete log observation is persisted.

The workflow requires the repository secret `AOE_DESKTOP_READ_TOKEN`. It must
be able to read Actions runs, jobs, artifacts, and logs from the private
`AOE-HQ/aoe-desktop` repository. The metrics repository's `GITHUB_TOKEN` is
used separately to commit generated files and dispatch the Pages deployment.

To inspect the current incremental range without changing files:

```bash
pnpm exec node src/update-hourly.mjs \
  --repo AOE-HQ/aoe-desktop \
  --workflow ci.yml \
  --checkpoint state/aoe-desktop-ci-checkpoint.json \
  --dry-run
```
