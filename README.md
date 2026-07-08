# AoE Desktop E2E CI Metrics

This public repository stores route-level CSV metrics for AoE Desktop GitHub CI
Playwright E2E runs.

## GitHub Pages

The public dashboard is generated from the CSV files and deployed with GitHub
Pages:

```bash
pnpm build:pages
```

The generated site reads the copied CSV files from `dist/data/` and exposes the
same raw CSV files for download. The deploy workflow runs on `main` pushes and
uses GitHub Pages Actions deployment.

Because this repository is public, route ids, module tags, branch names, run
ids, SHAs, CI conclusions, and normalized error signatures are public data. Do
not write secrets, private customer data, access tokens, or local machine paths
to any CSV in this repository.

## Scope

Version 1 tracks only the AoE Desktop Mock E2E Playwright `electron` project from
the main CI workflow. Unit tests, lint, format, build, visual tests, and
`electron-real` are intentionally out of scope.

## Data Files

- `data/routes.csv`: stable E2E route identity and module tags.
- `data/runs.csv`: GitHub Actions run metadata.
- `data/route_results.csv`: per-run, per-platform route results.
- `data/route_stats.csv`: aggregated route statistics.
- `config/route-module-overrides.csv`: manual module tag overrides.

An E2E route id is:

```text
<spec_file> :: <full Playwright title path>
```

The route id must never use execution order, test index, or line number.

## Current Run Update

AoE Desktop CI uploads Playwright JSON artifacts named `e2e-report-macos` and
`e2e-report-windows`. The CI metrics job checks out this repository and runs:

```bash
pnpm install --frozen-lockfile
pnpm update-current-run -- \
  --reports-dir ../metrics-input \
  --run-id "$GITHUB_RUN_ID" \
  --run-attempt "$GITHUB_RUN_ATTEMPT" \
  --run-number "$GITHUB_RUN_NUMBER" \
  --workflow "$GITHUB_WORKFLOW" \
  --branch "$GITHUB_REF_NAME" \
  --sha "$GITHUB_SHA" \
  --event "$GITHUB_EVENT_NAME" \
  --pr-number "$PR_NUMBER" \
  --started-at "$RUN_STARTED_AT" \
  --completed-at "$RUN_COMPLETED_AT" \
  --conclusion "$TEST_CONCLUSION" \
  --artifact-url "$RUN_URL" \
  --commit \
  --push \
  --push-retries 3
```

Metrics update failures are observability failures. AoE Desktop CI retries them
but does not let them block product CI.

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

Historical data is best-effort because old CI runs may not have Playwright JSON
artifacts. Run backfill manually from this repository:

```bash
pnpm backfill -- --repo AOE-HQ/aoe-desktop --workflow ci.yml --since 2026-01-01
```

Normal AoE Desktop CI updates only the current run.
