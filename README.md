# AoE Desktop E2E CI Metrics

This public repository stores route-level CSV metrics for AoE Desktop GitHub CI
Playwright E2E runs.

## Run Locally

Prerequisites: Node.js 22 and pnpm 10.24.0 (the version declared in
`package.json`). Install dependencies, build the static dashboard, and serve the
generated `dist/` directory:

```bash
pnpm install --frozen-lockfile
pnpm build:pages
pnpm dlx serve dist --listen 4173
```

Open <http://localhost:4173> in a browser. Stop the local server with `Ctrl+C`.
Re-run `pnpm build:pages` after changing source code or CSV data. The dashboard
must be served over HTTP because it loads generated data files with `fetch`;
opening `dist/index.html` directly is not supported.

## GitHub Pages

The dashboard is generated from the CSV files and deployed with GitHub Pages:

```bash
pnpm test
pnpm build:pages
```

The generated site reads the copied CSV files from `dist/data/` and exposes the
same raw CSV files for download. The deploy workflow runs on eligible `main`
pushes and can also be dispatched explicitly by the metrics update workflows.

In Route Explorer, search for a route and use **View failed commits** to load its
all-time final-failure history. The detail view groups macOS and Windows failures
by commit and links the commit, known PR, and GitHub Actions runs. Historical
failure data is emitted as a small route index plus per-route JSON shards so it
does not add the full result history to the initial page load.

Because this repository is public, route ids, module tags, branch names, run
ids, SHAs, CI conclusions, and normalized error signatures are public data. Do
not write secrets, private customer data, access tokens, or local machine paths
to any CSV in this repository.

## Scope

Version 1 tracks only the AoE Desktop Mock E2E Playwright `electron` project from
the main CI workflow. Unit tests, lint, format, build, visual tests, and
`electron-real` are intentionally out of scope. Complete Playwright outcomes
parsed from GitHub job logs are the source of truth for pass rates. Legacy JSON
artifacts are retained only as route-discovery fallback data when complete logs
are unavailable.

## Data Files

- `data/routes.csv`: stable E2E route identity and module tags.
- `data/runs.csv`: GitHub Actions run metadata.
- `data/route_results.csv`: per-run, per-platform route results.
- `data/route_stats.csv`: aggregated route statistics.
- `data/route_platform_stats.csv`: per-route, per-platform aggregate
  statistics.
- `config/route-module-overrides.csv`: manual module tag overrides.

An E2E route id is:

```text
<spec_file> :: <full Playwright title path>
```

The route id must never use execution order, test index, or line number.

## Automated Updates

AoE Desktop product CI does not clone or write this repository. The metrics
workflows use `AOE_DESKTOP_READ_TOKEN` to read completed macOS and Windows jobs,
prefer complete route outcomes parsed from job logs, and use downloaded
Playwright JSON reports only as route-discovery fallback data.

`.github/workflows/hourly-metrics.yml` performs the normal incremental update at
minute 17 of each hour. It resumes from
`state/aoe-desktop-ci-checkpoint.json`, commits the CSV files and checkpoint as a
single serialized writer, and explicitly dispatches the Pages workflow when data
changes. See `docs/hourly-update.md` for checkpoint and recovery details.

`.github/workflows/daily-summary.yml` runs once per UTC day and scans an
overlapping three-day window. It imports run attempts idempotently and creates at
most one data commit when the aggregate changes, providing a bounded recovery
path when one or more hourly schedules are delayed. Both writers share the
`e2e-ci-metrics-writer` concurrency group.

Configure `AOE_DESKTOP_READ_TOKEN` as a repository Actions secret. Use a
fine-grained token restricted to `AOE-HQ/aoe-desktop` with Actions read access
and repository contents/metadata read access. The metrics repository
`GITHUB_TOKEN` is used separately for its own `main` pushes and Pages dispatches.

For wider recovery, manually dispatch `Daily E2E Metrics Summary` and provide an
ISO date or timestamp in the `since` input. The workflow executes the equivalent
of:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm backfill -- \
  --repo AOE-HQ/aoe-desktop \
  --workflow ci.yml \
  --since 2026-07-07 \
  --retries 3 \
  --quiet-skips
```

Daily summary failures are visible in this repository and can be manually
retried, but they have no dependency edge back to AoE Desktop product CI.

## Module Tags

The updater infers candidate module tags from the spec filename and title. When
`config/route-module-overrides.csv` contains a row for a route, the override is
the source of truth.

Use semicolon-separated tags:

```csv
route_id,module_tags,note
"tests/e2e/specs/foo.spec.ts :: describe > test","chat;browser","cross-module route"
```

## Historical Backfill

Historical data is best-effort. Backfill downloads the macOS/Windows Test job
logs and parses standard Playwright list-reporter rows (`✓`/`✘` on macOS,
`ok`/`x` on Windows, and `-` for skipped routes). A run/platform is counted as a
complete observation only when the parsed route outcomes match the Playwright
footer totals. Older logs that contain only failure summaries remain partial
failure/flaky signals. Run backfill manually from this repository:

```bash
pnpm backfill -- --repo AOE-HQ/aoe-desktop --workflow ci.yml --since 2026-01-01
```

To upgrade only rows from a legacy source without expanding every historical
run, use a bounded date range and `--refresh-source`, for example:

```bash
pnpm backfill -- --repo AOE-HQ/aoe-desktop --workflow ci.yml \
  --since 2026-07-07 --until 2026-07-09 \
  --refresh-source artifact_json
```

The hourly updater handles normal incremental imports. The daily summary uses
the same backfill path with a bounded recent window; wider historical scans and
source migrations remain manual.

The updater is idempotent by `run_id` and `run_attempt`: rerunning the same CI
attempt replaces that attempt's rows, then recomputes aggregate CSV files from
the full `route_results.csv`. It does not delete other historical runs.

Backfill automatically splits large created-date ranges before listing workflow
runs because GitHub caps a single Actions run search window at 1000 results.
GitHub API and log downloads are retried. Imported runs are written in batches
so a bounded refresh does not repeatedly rewrite the entire CSV dataset. Each
run attempt is inspected independently; temporary log failures, artifact-only
fallbacks, and unavailable logs remain retryable until complete outcomes are
persisted.
