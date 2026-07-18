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
After a successful backfill, any completed run recorded in `data/runs.csv` can
advance the checkpoint. Artifact-only, legacy partial, mixed-source, and
`unavailable_job_log` rows remain explicit partial observations, but no longer
hold all newer data behind them. The bounded daily summary retries recent
partial observations; older recovery remains available through a bounded
manual `--refresh-source` run.

Route-result details are stored in `data/route_results/YYYY-MM-DD.csv`. A
normal update rewrites only affected UTC-day shards, while a historical
backfill rebuilds aggregate tables once after all raw batches are persisted.
The hourly workflow also rejects any file under `data/` larger than 95 MiB
before attempting a Git push.

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
