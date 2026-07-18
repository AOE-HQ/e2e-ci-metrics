#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HEADERS, computeWindowedMetrics, readTable } from './metrics-core.mjs';
import { buildRouteFailureHistory } from './route-failure-history.mjs';
import { listRouteResultShardFiles, readRouteResults } from './route-results-store.mjs';

const repoRoot = process.cwd();
const distDir = path.join(repoRoot, 'dist');
const dataDir = path.join(repoRoot, 'data');
const distDataDir = path.join(distDir, 'data');
const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_WINDOWS = [
  { key: '30d', label: 'Last 30 days', durationMs: 30 * DAY_MS },
  { key: '7d', label: 'Last 7 days', durationMs: 7 * DAY_MS },
  { key: '1d', label: 'Last 24 hours', durationMs: DAY_MS },
];

const csvFiles = ['routes.csv', 'runs.csv', 'route_stats.csv', 'route_platform_stats.csv'];
const generatedAt = resolveBuildTime();

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDataDir, { recursive: true });

for (const fileName of csvFiles) {
  copyFileSync(path.join(dataDir, fileName), path.join(distDataDir, fileName));
}
const routeResultsManifest = copyRouteResultShards();

const sourceData = readSourceData();
const timeWindows = buildTimeWindowData(generatedAt, sourceData);
const failureHistory = buildRouteFailureHistory({ ...sourceData, generatedAt });
const failureHistoryManifest = writeFailureHistory(failureHistory);
writeFileSync(path.join(distDir, '.nojekyll'), '');
writeFileSync(
  path.join(distDir, 'manifest.json'),
  `${JSON.stringify(
    buildManifest(generatedAt, timeWindows, failureHistoryManifest, routeResultsManifest),
    null,
    2,
  )}\n`,
);
writeFileSync(path.join(distDir, 'index.html'), buildIndexHtml());

function resolveBuildTime() {
  const value = process.env.METRICS_AS_OF || new Date().toISOString();
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid METRICS_AS_OF timestamp: ${value}`);
  }
  return timestamp.toISOString();
}

function readSourceData() {
  return {
    routes: readTable(path.join(dataDir, 'routes.csv'), HEADERS.routes),
    runs: readTable(path.join(dataDir, 'runs.csv'), HEADERS.runs),
    routeResults: readRouteResults({ repoRoot }),
  };
}

function copyRouteResultShards() {
  const outputDirectory = path.join(distDataDir, 'route_results');
  const files = [];
  mkdirSync(outputDirectory, { recursive: true });

  for (const sourcePath of listRouteResultShardFiles({ repoRoot })) {
    const fileName = path.basename(sourcePath);
    const content = readFileSync(sourcePath, 'utf8');
    const lineCount = content.trim() ? content.trimEnd().split(/\r?\n/).length : 0;
    copyFileSync(sourcePath, path.join(outputDirectory, fileName));
    files.push({
      date: path.basename(fileName, '.csv'),
      path: `data/route_results/${fileName}`,
      data_rows: Math.max(0, lineCount - 1),
      size_bytes: Buffer.byteLength(content),
    });
  }

  const index = { schema_version: 1, files };
  writeFileSync(path.join(outputDirectory, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return {
    index_file: 'data/route_results/index.json',
    shard_count: files.length,
    data_rows: files.reduce((total, file) => total + file.data_rows, 0),
  };
}

function writeFailureHistory(history) {
  const directoryName = 'route_failures';
  const outputDirectory = path.join(distDataDir, directoryName);
  const routeFiles = {};
  mkdirSync(outputDirectory, { recursive: true });

  for (const route of history.routes) {
    const fileName = `${createHash('sha256').update(route.route_id).digest('hex').slice(0, 20)}.json`;
    writeFileSync(path.join(outputDirectory, fileName), `${JSON.stringify(route)}\n`);
    routeFiles[route.route_id] = `data/${directoryName}/${fileName}`;
  }

  const indexFile = 'route_failure_index.json';
  writeFileSync(
    path.join(distDataDir, indexFile),
    `${JSON.stringify({ generated_at: history.generated_at, routes: routeFiles })}\n`,
  );
  return { index_file: `data/${indexFile}` };
}

function buildTimeWindowData(asOf, { routes, runs, routeResults }) {
  const metrics = computeWindowedMetrics({ routes, routeResults, runs, asOf, windows: TIME_WINDOWS });
  const fileName = 'window_stats.json';
  writeFileSync(path.join(distDataDir, fileName), `${JSON.stringify(metrics)}\n`);
  return {
    as_of: metrics.asOf,
    data_file: `data/${fileName}`,
    options: TIME_WINDOWS.map(({ key, label }) => ({ key, label, since: metrics.windows[key].since })),
  };
}

function buildManifest(generatedAt, timeWindows, failureHistory, routeResults) {
  const files = Object.fromEntries(
    csvFiles.map((fileName) => {
      const content = readFileSync(path.join(dataDir, fileName), 'utf8');
      const lineCount = content.trim() ? content.trimEnd().split(/\r?\n/).length : 0;
      return [fileName, { line_count: lineCount, data_rows: Math.max(0, lineCount - 1) }];
    }),
  );

  return {
    generated_at: generatedAt,
    files: { ...files, route_results: routeResults },
    time_windows: timeWindows,
    failure_history: failureHistory,
  };
}

function buildIndexHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AoE Desktop E2E CI Metrics</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3f6fa;
        --panel: #ffffff;
        --line: #d9e2ec;
        --line-soft: #e9eef4;
        --text: #142033;
        --muted: #58677d;
        --teal: #0f766e;
        --blue: #2563eb;
        --red: #b42318;
        --yellow: #d6a700;
        --yellow-text: #8a6d00;
        --green: #16703c;
        --violet: #6d28d9;
        --neutral: #718096;
        --red-soft: #fff0ed;
        --yellow-soft: #fff8d6;
        --green-soft: #e8f7ee;
        --neutral-soft: #eef2f6;
        --shadow: 0 1px 2px rgba(20, 31, 48, 0.05), 0 10px 28px rgba(20, 31, 48, 0.05);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background:
          radial-gradient(circle at top left, rgba(37, 99, 235, 0.06), transparent 34rem),
          var(--bg);
        color: var(--text);
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.45;
      }

      a {
        color: var(--teal);
      }

      .shell {
        width: min(1520px, calc(100% - 40px));
        margin: 0 auto;
        padding: 32px 0 48px;
      }

      header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 18px;
      }

      h1 {
        margin: 0 0 8px;
        font-size: clamp(32px, 4vw, 48px);
        line-height: 1.05;
        letter-spacing: -0.025em;
      }

      h2 {
        margin: 0;
        font-size: 19px;
        letter-spacing: -0.01em;
      }

      .subtitle {
        margin: 0;
        color: var(--muted);
        max-width: 860px;
        font-size: 15px;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }

      .button {
        display: inline-flex;
        align-items: center;
        min-height: 36px;
        padding: 0 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        color: var(--text);
        text-decoration: none;
        font-size: 13px;
        font-weight: 700;
        white-space: nowrap;
      }

      .button:hover {
        border-color: #b7c4d4;
        background: #f8fafc;
      }

      :where(a, button, input, select, summary):focus-visible {
        outline: 3px solid rgba(37, 99, 235, 0.28);
        outline-offset: 2px;
      }

      .hero-grid {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr);
        gap: 14px;
      }

      .scoreboard {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }

      .metric,
      .panel,
      .risk-card,
      .platform-card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 12px;
        box-shadow: var(--shadow);
      }

      .metric {
        min-height: 108px;
        padding: 14px 15px;
        border-top-width: 3px;
      }

      .metric.tone-success {
        border-top-color: var(--green);
        background: linear-gradient(180deg, var(--green-soft), #ffffff 70%);
      }

      .metric.tone-flaky {
        border-top-color: var(--yellow);
        background: linear-gradient(180deg, var(--yellow-soft), #ffffff 70%);
      }

      .metric.tone-fail {
        border-top-color: var(--red);
        background: linear-gradient(180deg, var(--red-soft), #ffffff 70%);
      }

      .metric-label {
        color: var(--muted);
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
      }

      .metric-value {
        margin-top: 8px;
        font-size: 31px;
        font-weight: 850;
        line-height: 1.05;
      }

      .tone-success .metric-value,
      .status.tone-success,
      .text-success {
        color: var(--green);
      }

      .tone-flaky .metric-value,
      .status.tone-flaky,
      .text-flaky {
        color: var(--yellow-text);
      }

      .tone-fail .metric-value,
      .status.tone-fail,
      .text-fail {
        color: var(--red);
      }

      .status {
        text-transform: lowercase;
      }

      .metric-note {
        margin-top: 5px;
        color: var(--muted);
        font-size: 13px;
      }

      .panel {
        margin-top: 14px;
        padding: 18px;
        min-width: 0;
      }

      .panel-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 12px;
      }

      .panel-heading h2 {
        flex: 0 0 auto;
      }

      .muted {
        color: var(--muted);
      }

      .platform-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .platform-card {
        padding: 14px;
        box-shadow: none;
      }

      .platform-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }

      .platform-title strong {
        font-size: 18px;
      }

      .bar {
        display: flex;
        width: 100%;
        height: 12px;
        overflow: hidden;
        border-radius: 999px;
        background: #edf1f5;
      }

      .bar span {
        min-width: 0;
      }

      .bar-pass {
        background: var(--green);
      }

      .bar-flaky {
        background: var(--yellow);
      }

      .bar-fail {
        background: var(--red);
      }

      .bar-skip {
        background: #a3adba;
      }

      .platform-stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        margin-top: 12px;
      }

      .mini-stat {
        border: 1px solid var(--line-soft);
        border-radius: 7px;
        padding: 8px;
        background: #fbfcfe;
      }

      .mini-stat span {
        display: block;
        color: var(--muted);
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
      }

      .mini-stat strong {
        display: block;
        margin-top: 2px;
        font-size: 18px;
      }

      .mini-stat.tone-success strong {
        color: var(--green);
      }

      .mini-stat.tone-flaky strong {
        color: var(--yellow-text);
      }

      .mini-stat.tone-fail strong {
        color: var(--red);
      }

      .risk-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }

      .risk-card {
        padding: 13px;
        min-width: 0;
        box-shadow: none;
      }

      .route-heading {
        min-width: 0;
      }

      .route-spec {
        display: block;
        margin-bottom: 3px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 750;
        overflow-wrap: anywhere;
      }

      .route-title {
        display: -webkit-box;
        min-height: 42px;
        overflow: hidden;
        color: var(--text);
        font-weight: 800;
        overflow-wrap: anywhere;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      .risk-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 10px 0;
      }

      .pill,
      .tag {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 800;
      }

      .pill {
        padding: 0 8px;
        background: #f2f5f8;
        color: #435066;
      }

      .pill.tone-fail {
        background: var(--red-soft);
        color: var(--red);
      }

      .pill.tone-flaky {
        background: var(--yellow-soft);
        color: var(--yellow-text);
      }

      .pill.tone-success {
        background: var(--green-soft);
        color: var(--green);
      }

      .pill.tone-neutral {
        background: var(--neutral-soft);
        color: #526174;
      }

      .tag-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .tag {
        padding: 0 7px;
        background: #e5f3f1;
        color: #0f5e57;
      }

      .error-line {
        display: -webkit-box;
        min-height: 34px;
        overflow: hidden;
        color: var(--muted);
        font-size: 12px;
        overflow-wrap: anywhere;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      .error-label {
        display: block;
        margin-bottom: 3px;
        color: #7b8798;
        font-size: 10px;
        font-weight: 850;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .controls {
        display: grid;
        grid-template-columns: minmax(260px, 1fr) minmax(220px, 320px) 180px 140px;
        align-items: start;
        gap: 10px;
        margin-bottom: 8px;
      }

      .control-field {
        display: grid;
        gap: 5px;
        min-width: 0;
      }

      .control-label {
        color: var(--muted);
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      input,
      select {
        width: 100%;
        min-height: 38px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #ffffff;
        color: var(--text);
        padding: 0 10px;
        font: inherit;
      }

      .multi-select {
        position: relative;
      }

      .multi-select summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 38px;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 0 10px;
        background: #ffffff;
        cursor: pointer;
        list-style: none;
      }

      .multi-select summary::-webkit-details-marker {
        display: none;
      }

      .multi-select summary::after {
        content: '▾';
        color: var(--muted);
        font-size: 12px;
      }

      .multi-select[open] summary::after {
        transform: rotate(180deg);
      }

      .multi-select-popover {
        position: absolute;
        z-index: 10;
        top: calc(100% + 6px);
        right: 0;
        width: min(320px, calc(100vw - 40px));
        max-height: 320px;
        overflow: auto;
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 10px;
        background: #ffffff;
        box-shadow: var(--shadow);
      }

      .multi-select-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 750;
      }

      .multi-select-heading button {
        min-height: 28px;
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 0 8px;
        background: #ffffff;
        color: var(--blue);
        cursor: pointer;
        font: inherit;
        font-weight: 800;
      }

      .module-filter-options {
        display: grid;
        gap: 3px;
      }

      .module-option {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 32px;
        border-radius: 6px;
        padding: 4px 6px;
        cursor: pointer;
      }

      .module-option:hover {
        background: #f3f6fa;
      }

      .module-option input {
        width: 16px;
        min-height: 16px;
        margin: 0;
        padding: 0;
      }

      .route-sort-note {
        margin: 0 0 12px;
        color: var(--muted);
        font-size: 12px;
      }

      .table-wrap {
        width: 100%;
        max-width: 100%;
        overflow: auto;
        border: 1px solid var(--line);
        border-radius: 8px;
      }

      table {
        width: 100%;
        min-width: 1180px;
        border-collapse: collapse;
        background: #ffffff;
      }

      th,
      td {
        padding: 9px 10px;
        border-bottom: 1px solid var(--line-soft);
        text-align: left;
        vertical-align: top;
        font-size: 13px;
      }

      th {
        position: sticky;
        top: 0;
        z-index: 1;
        background: #f4f7fa;
        color: #3d4a60;
        font-size: 12px;
        text-transform: uppercase;
      }

      caption {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      tbody tr:hover {
        background: #f9fbfd;
      }

      .route-cell {
        min-width: 440px;
        max-width: 680px;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .failure-history-actions {
        margin-top: 8px;
      }

      .failure-history-trigger {
        min-height: 30px;
        padding: 0 9px;
        border: 1px solid #b8c7d9;
        border-radius: 6px;
        background: #f7fafc;
        color: #1f4f83;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        font-weight: 800;
      }

      .failure-history-trigger:hover {
        border-color: #8ca6c2;
        background: #eef5fb;
      }

      .failure-history-detail > td {
        padding: 0;
        background: #f7fafc;
      }

      .failure-history {
        min-width: 0;
        padding: 16px;
      }

      .failure-history-heading {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }

      .failure-history-heading h3,
      .failure-history-heading p {
        margin: 0;
      }

      .failure-history-heading p {
        color: var(--muted);
        font-size: 12px;
      }

      .failure-history .table-wrap {
        background: #ffffff;
      }

      .failure-history table {
        min-width: 900px;
      }

      .failure-history td {
        font-size: 12px;
      }

      .failure-history-links {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 8px;
      }

      .failure-history-error {
        max-width: 360px;
        color: var(--muted);
        overflow-wrap: anywhere;
      }

      .health {
        min-width: 220px;
      }

      .health .bar {
        height: 8px;
        margin-top: 6px;
      }

      .health-block {
        display: grid;
        gap: 8px;
      }

      .health-title {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        font-weight: 850;
      }

      .platform-pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        min-width: 220px;
      }

      .platform-chip {
        border: 1px solid var(--line-soft);
        border-radius: 7px;
        padding: 7px;
        background: #fbfcfd;
      }

      .platform-chip strong {
        display: block;
        margin-bottom: 2px;
        font-size: 12px;
      }

      .module-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }

      .module-item {
        position: relative;
        border: 1px solid var(--line-soft);
        border-radius: 10px;
        padding: 13px;
        background: #fcfdff;
        transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
      }

      .module-item:hover,
      .module-item:focus-within {
        border-color: #9cb7df;
        box-shadow: 0 8px 20px rgba(37, 99, 235, 0.08);
        transform: translateY(-1px);
      }

      .module-item:focus-within {
        outline: 3px solid var(--blue);
        outline-offset: 2px;
      }

      .module-item.is-selected {
        border-color: var(--blue);
        background: #f3f7ff;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.14);
      }

      .module-filter-trigger {
        display: block;
        width: 100%;
        margin-bottom: 8px;
        border: 0;
        padding: 0;
        background: transparent;
        color: var(--text);
        cursor: pointer;
        font: inherit;
        font-size: 15px;
        font-weight: 800;
        text-align: left;
      }

      .module-filter-trigger::after {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        content: '';
      }

      .module-filter-trigger:focus-visible {
        outline: none;
      }

      .module-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        color: var(--muted);
        font-size: 12px;
      }

      .module-row + .module-row {
        margin-top: 4px;
      }

      .module-row strong {
        color: var(--text);
      }

      .module-row.tone-success strong {
        color: var(--green);
      }

      .module-row.tone-flaky strong {
        color: var(--yellow-text);
      }

      .module-row.tone-fail strong {
        color: var(--red);
      }

      .outcome-legend {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        color: var(--muted);
        font-size: 12px;
      }

      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
      }

      .legend-dot {
        width: 9px;
        height: 9px;
        border-radius: 999px;
      }

      .legend-dot.success {
        background: var(--green);
      }

      .legend-dot.flaky {
        background: var(--yellow);
      }

      .legend-dot.fail {
        background: var(--red);
      }

      .pagination {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
        color: var(--muted);
        font-size: 13px;
      }

      .pagination button {
        min-height: 32px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #ffffff;
        color: var(--text);
        padding: 0 10px;
        font: inherit;
        font-weight: 750;
        cursor: pointer;
      }

      .pagination button:disabled {
        cursor: default;
        opacity: 0.45;
      }

      .empty {
        padding: 26px;
        color: var(--muted);
        text-align: center;
      }

      @media (max-width: 1180px) {
        .risk-grid,
        .module-grid {
          grid-template-columns: 1fr 1fr;
        }

        .hero-grid {
          grid-template-columns: 1fr;
        }

        .scoreboard {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .controls {
          grid-template-columns: 1fr 1fr;
        }
      }

      @media (max-width: 760px) {
        header,
        .panel-heading {
          flex-direction: column;
          align-items: stretch;
        }

        .actions {
          justify-content: flex-start;
        }

        .hero-grid,
        .scoreboard,
        .platform-grid,
        .risk-grid,
        .module-grid,
        .controls {
          grid-template-columns: 1fr;
        }

        .shell {
          width: min(100% - 20px, 1480px);
          padding-top: 18px;
        }

        .platform-stats {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .multi-select-popover {
          position: static;
          width: 100%;
          margin-top: 6px;
          box-shadow: none;
        }

        table {
          min-width: 0;
          table-layout: fixed;
        }

        thead {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }

        tbody,
        tr,
        td {
          display: block;
          width: 100%;
        }

        tr {
          padding: 10px;
          border-bottom: 1px solid var(--line-soft);
        }

        td {
          padding: 7px 0;
          border-bottom: 0;
          overflow-wrap: anywhere;
        }

        td::before {
          display: block;
          margin-bottom: 4px;
          color: var(--muted);
          content: attr(data-label);
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .route-cell,
        .health,
        .platform-pair {
          min-width: 0;
          max-width: 100%;
        }

        .failure-history {
          padding: 12px;
        }

        .failure-history-heading {
          display: block;
        }

        .failure-history-detail > td::before {
          display: none;
        }
      }

      @media (max-width: 480px) {
        .platform-pair {
          grid-template-columns: 1fr;
        }

        .metric-value {
          font-size: 28px;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header>
        <div>
          <h1>AoE Desktop E2E CI Metrics</h1>
          <p class="subtitle">Route-level Playwright E2E outcomes from AoE Desktop GitHub CI. Every dashboard outcome is derived from GitHub job logs; legacy JSON artifacts are used only to discover route names.</p>
        </div>
        <nav class="actions" aria-label="CSV downloads">
          <a class="button" href="data/routes.csv">routes</a>
          <a class="button" href="data/runs.csv">runs</a>
          <a class="button" href="data/route_results/index.json">results</a>
          <a class="button" href="data/route_stats.csv">route stats</a>
          <a class="button" href="data/route_platform_stats.csv">platform stats</a>
        </nav>
      </header>

      <section class="hero-grid">
        <div class="scoreboard" aria-label="Summary metrics">
          <div class="metric"><div class="metric-label">Complete Outcomes</div><div id="metric-observations" class="metric-value">...</div><div class="metric-note">route outcomes verified against log totals</div></div>
          <div class="metric tone-success"><div class="metric-label">Success</div><div id="metric-success" class="metric-value">...</div><div class="metric-note">passed without a failed attempt</div></div>
          <div class="metric tone-flaky"><div class="metric-label">Flaky</div><div id="metric-flaky" class="metric-value">...</div><div class="metric-note">failed first, then passed on retry</div></div>
          <div class="metric tone-fail"><div class="metric-label">Failed</div><div id="metric-failing" class="metric-value">...</div><div class="metric-note">final route failures</div></div>
          <div class="metric tone-success"><div class="metric-label">Clean Success Rate</div><div id="metric-pass-rate" class="metric-value">...</div><div class="metric-note">success / complete outcomes</div></div>
          <div class="metric"><div class="metric-label">CI Runs</div><div id="metric-runs" class="metric-value">...</div><div id="metric-runs-note" class="metric-note">Loading</div></div>
        </div>
        <section class="panel" style="margin-top: 0">
          <div class="panel-heading">
            <h2>Latest Run</h2>
            <span id="generated-at" class="muted">Loading</span>
          </div>
          <div id="latest-run" aria-live="polite"></div>
        </section>
      </section>

      <section class="panel">
          <div class="panel-heading">
            <h2>Platform Health</h2>
            <span class="outcome-legend" aria-label="Outcome colors">
              <span class="legend-item"><span class="legend-dot success"></span>success</span>
              <span class="legend-item"><span class="legend-dot flaky"></span>flaky</span>
              <span class="legend-item"><span class="legend-dot fail"></span>failed</span>
            </span>
          </div>
        <div id="platform-cards" class="platform-grid"></div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <h2>Attention Queue</h2>
          <span class="muted">Routes sorted by final failures, flaky recoveries, and raw attempt failures</span>
        </div>
        <div id="risk-cards" class="risk-grid"></div>
      </section>

      <section class="panel">
          <div class="panel-heading">
            <h2>Module Hotspots</h2>
            <span id="module-count" class="muted" aria-live="polite">Loading</span>
        </div>
        <div id="module-grid" class="module-grid"></div>
      </section>

      <section id="route-explorer" class="panel">
          <div class="panel-heading">
          <h2 id="route-explorer-title" tabindex="-1">Route Explorer</h2>
            <span id="route-count" class="muted" aria-live="polite">Loading</span>
        </div>
        <div class="controls">
          <label class="control-field"><span class="control-label">Search</span><input id="search" type="search" placeholder="Route, module, or error"></label>
          <div class="control-field">
            <span id="module-filter-label" class="control-label">Module</span>
            <details id="module-filter" class="multi-select">
              <summary aria-labelledby="module-filter-label module-filter-summary"><span id="module-filter-summary">All modules</span></summary>
              <div class="multi-select-popover">
                <div class="multi-select-heading"><span>Select one or more</span><button id="module-filter-clear" type="button">Clear</button></div>
                <div id="module-filter-options" class="module-filter-options"></div>
              </div>
            </details>
          </div>
          <div class="control-field"><label class="control-label" for="time-range">Time range</label><select id="time-range">
              <option value="all">All time</option>
              <option value="30d">Last 30 days</option>
              <option value="7d">Last 7 days</option>
              <option value="1d">Last 24 hours</option>
            </select></div>
          <label class="control-field"><span class="control-label">Rows</span><select id="route-page-size">
              <option value="25">25 / page</option>
              <option value="50" selected>50 / page</option>
              <option value="100">100 / page</option>
            </select></label>
        </div>
        <p class="route-sort-note">Sorted by success rate = success / complete outcomes, lowest first. Flaky and failed outcomes are not success; routes without complete outcomes appear last.</p>
        <div class="table-wrap">
          <table aria-labelledby="route-explorer-title">
            <caption>Route outcomes by module and platform</caption>
            <thead>
              <tr>
                <th scope="col">Route</th>
                <th scope="col">Modules</th>
                <th scope="col">Historical Outcomes</th>
                <th scope="col">Platform Detail</th>
                <th scope="col">Latest</th>
                <th scope="col">Top Error</th>
              </tr>
            </thead>
            <tbody id="routes-body"></tbody>
          </table>
        </div>
        <div id="routes-pagination" class="pagination"></div>
      </section>

      <section class="panel">
          <div class="panel-heading">
            <h2>CI Runs</h2>
            <span id="run-count" class="muted" aria-live="polite">Loading</span>
          </div>
        <div class="table-wrap">
          <table>
            <caption>Imported GitHub Actions CI runs</caption>
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Attempt</th>
                <th scope="col">Workflow</th>
                <th scope="col">Branch</th>
                <th scope="col">Event</th>
                <th scope="col">Source</th>
                <th scope="col">Started</th>
                <th scope="col">Completed</th>
                <th scope="col">Conclusion</th>
              </tr>
            </thead>
            <tbody id="runs-body"></tbody>
          </table>
        </div>
        <div id="runs-pagination" class="pagination"></div>
      </section>
    </main>

    <script>
      const files = {
        manifest: 'manifest.json',
        runs: 'data/runs.csv',
        stats: 'data/route_stats.csv',
        platformStats: 'data/route_platform_stats.csv',
      };

      const state = {
        runs: [],
        stats: [],
        statsByRoute: new Map(),
        platformStats: [],
        platformByRoute: new Map(),
        routeStats: [],
        routePlatformByRoute: new Map(),
        failureHistoryIndexFile: '',
        failureHistoryIndexPromise: null,
        failureHistoryRoutePromises: new Map(),
        timeRange: 'all',
        timeWindowFile: '',
        timeWindowDataPromise: null,
        selectedModules: new Set(),
        routePage: 1,
        routePageSize: 50,
        runPage: 1,
        runPageSize: 50,
      };

      Promise.all([
        fetchJson(files.manifest),
        fetchCsv(files.runs),
        fetchCsv(files.stats),
        fetchCsv(files.platformStats),
      ])
        .then(([manifest, runs, stats, platformStats]) => {
          state.runs = runs;
          state.stats = stats;
          state.statsByRoute = new Map(stats.map((row) => [row.route_id, row]));
          state.platformStats = platformStats;
          state.platformByRoute = groupPlatformStats(platformStats);
          state.routeStats = stats;
          state.routePlatformByRoute = state.platformByRoute;
          state.timeWindowFile = manifest.time_windows?.data_file ?? '';
          state.failureHistoryIndexFile = manifest.failure_history?.index_file ?? '';
          renderSummary(manifest);
          renderPlatformHealth();
          renderRiskCards();
          renderModules();
          renderRuns();
          renderModuleFilter();
          bindControls();
          renderRoutes();
        })
        .catch((error) => {
          document.querySelector('.shell').insertAdjacentHTML(
            'afterbegin',
            '<div class="panel" role="alert"><strong>Failed to load metrics.</strong><br><span class="muted">' +
              escapeHtml(error.message) +
              '</span></div>',
          );
        });

      async function fetchJson(url) {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Could not load ' + url);
        }
        return response.json();
      }

      async function fetchCsv(url) {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Could not load ' + url);
        }
        return parseCsv(await response.text());
      }

      function parseCsv(text) {
        const rows = [];
        let row = [];
        let value = '';
        let quoted = false;

        for (let index = 0; index < text.length; index += 1) {
          const char = text[index];
          const next = text[index + 1];

          if (quoted) {
            if (char === '"' && next === '"') {
              value += '"';
              index += 1;
            } else if (char === '"') {
              quoted = false;
            } else {
              value += char;
            }
            continue;
          }

          if (char === '"') {
            quoted = true;
          } else if (char === ',') {
            row.push(value);
            value = '';
          } else if (char === '\\n') {
            row.push(value);
            rows.push(row);
            row = [];
            value = '';
          } else if (char !== '\\r') {
            value += char;
          }
        }

        if (value || row.length > 0) {
          row.push(value);
          rows.push(row);
        }

        const [headers = [], ...records] = rows;
        return records
          .filter((record) => record.some(Boolean))
          .map((record) =>
            Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ''])),
          );
      }

      function renderSummary(manifest) {
        const fullObservations = sum(state.stats.map((row) => number(row.full_runs)));
        const fullFailures = sum(state.stats.map((row) => number(row.full_failed_runs)));
        const fullFlaky = sum(state.stats.map((row) => number(row.full_flaky_runs)));
        const fullSuccess = Math.max(0, fullObservations - fullFailures - fullFlaky);
        const passRate = fullObservations ? fullSuccess / fullObservations : null;
        const lastRun = latestRun();
        const fullRuns = state.runs.filter((run) => String(run.data_source || '').includes('job_log_route_metric')).length;
        const partialOnlyRuns = state.runs.filter((run) => {
          const source = String(run.data_source || '');
          return source.includes('job_log_failure_summary') && !source.includes('job_log_route_metric');
        }).length;

        setText('metric-runs', state.runs.length);
        setText('metric-runs-note', fullRuns + ' complete log runs · ' + partialOnlyRuns + ' partial-only');
        setText('metric-observations', fullObservations);
        setText('metric-success', fullSuccess);
        setText('metric-failing', fullFailures);
        setText('metric-flaky', fullFlaky);
        setText('metric-pass-rate', passRate === null ? 'n/a' : formatPercent(passRate));
        setText('generated-at', 'Generated ' + formatDateTime(manifest.generated_at));
        renderLatestRun(lastRun);
      }

      function renderLatestRun(run) {
        const container = document.getElementById('latest-run');
        if (!run) {
          container.innerHTML = '<div class="muted">No imported runs.</div>';
          return;
        }

        container.innerHTML =
          '<div class="metric-label">Run #' + escapeHtml(run.run_number || run.run_id) + '</div>' +
          '<div class="metric-value status ' + statusTone(run.conclusion) + '">' + escapeHtml(run.conclusion || 'unknown') + '</div>' +
          '<div class="metric-note">' + escapeHtml(run.branch || 'unknown branch') + ' · ' + escapeHtml(run.event || 'unknown event') + '</div>' +
          '<div class="metric-note">Source ' + escapeHtml(formatSource(run.data_source)) + '</div>' +
          '<div class="metric-note">Completed ' + formatDateTime(run.completed_at) + '</div>';
      }

      function renderPlatformHealth() {
        const cards = document.getElementById('platform-cards');
        const summaries = summarizePlatformStats();
        const preferred = ['macos', 'windows'];
        cards.innerHTML = preferred
          .map((platform) => renderPlatformCard(platform, summaries.get(platform) ?? emptyPlatformSummary(platform)))
          .join('');
      }

      function renderPlatformCard(platform, summary) {
        const passRate = summary.fullTotal ? summary.fullPassed / summary.fullTotal : null;
        const partial = {
          failed: Math.max(0, summary.logFailed - summary.fullFailed),
          flaky: Math.max(0, summary.logFlaky - summary.fullFlaky),
          total: Math.max(0, summary.logSignals - summary.fullTotal),
        };
        return (
          '<article class="platform-card">' +
          '<div class="platform-title"><strong>' + platformLabel(platform) + '</strong><span class="pill ' + (passRate === null ? 'tone-neutral' : 'tone-success') + '">' + (passRate === null ? 'no complete log' : formatPercent(passRate) + ' clean success') + '</span></div>' +
          renderOutcomeBar(summary) +
          '<div class="platform-stats">' +
          miniStat('Success', summary.fullPassed, 'tone-success') +
          miniStat('Flaky', summary.fullFlaky, 'tone-flaky') +
          miniStat('Failed', summary.fullFailed, 'tone-fail') +
          miniStat('Complete', summary.fullTotal) +
          '</div>' +
          renderPartialLogNote(partial) +
          '<div class="metric-note"><span class="text-fail">' + summary.attemptFailures + ' failed attempts</span> across complete and partial log history</div>' +
          '</article>'
        );
      }

      function renderRiskCards() {
        const container = document.getElementById('risk-cards');
        const rows = [...state.stats].sort(compareRiskRoutes).slice(0, 6);
        if (rows.length === 0) {
          container.innerHTML = '<div class="empty">No routes imported yet.</div>';
          return;
        }
        container.innerHTML = rows.map(renderRiskCard).join('');
      }

      function renderRiskCard(row) {
        const platforms = state.platformByRoute.get(row.route_id) ?? new Map();
        const macos = platforms.get('macos');
        const windows = platforms.get('windows');
        return (
          '<article class="risk-card">' +
          renderRouteHeading(row.route_id) +
          '<div class="risk-meta">' +
          '<span class="pill tone-success">' + cleanPassed(row) + ' success</span>' +
          '<span class="pill tone-flaky">' + number(row.log_flaky_runs) + ' flaky signals</span>' +
          '<span class="pill tone-fail">' + number(row.log_failed_runs) + ' failure signals</span>' +
          '<span class="pill tone-fail">' + number(row.attempt_failures) + ' failed attempts</span>' +
          '</div>' +
          renderTags(row.module_tags) +
          '<div class="platform-pair" style="margin-top: 10px">' +
          renderPlatformChip('macOS', macos) +
          renderPlatformChip('Windows', windows) +
          '</div>' +
          '<div class="error-line" style="margin-top: 10px"><span class="error-label">Top error</span>' + escapeHtml(row.top_error_signature || row.last_failed_at || 'No captured error signature') + '</div>' +
          '</article>'
        );
      }

      function renderModules() {
        const modules = moduleSummaries().slice(0, 12);
        setText('module-count', modules.length + ' modules shown');
        const grid = document.getElementById('module-grid');
        grid.innerHTML = modules.map(renderModule).join('');
        for (const button of grid.querySelectorAll('.module-filter-trigger')) {
          button.addEventListener('click', () => {
            state.selectedModules.clear();
            state.selectedModules.add(button.dataset.module);
            commitModuleSelection({ scrollToExplorer: true });
          });
        }
        syncModuleCards();
      }

      function renderModule(module) {
        const outcomes = moduleOutcomeCounts(module);
        const legacyFailed = Math.max(0, module.logFailed - module.fullFailed);
        const legacyFlaky = Math.max(0, module.logFlaky - module.fullFlaky);
        const legacyTotal = Math.max(0, module.log - module.full);
        return (
          '<div class="module-item" data-module-card="' + escapeHtml(module.name) + '">' +
          '<button type="button" class="module-filter-trigger" data-module="' + escapeHtml(module.name) + '" aria-label="Filter routes by module ' + escapeHtml(module.name) + '" aria-controls="route-explorer" aria-pressed="false">' + escapeHtml(module.name) + '</button>' +
          renderModuleBar(outcomes) +
          '<div class="module-row"><span>routes</span><strong>' + module.routes + '</strong></div>' +
          '<div class="module-row"><span>known log outcomes</span><strong>' + outcomes.total + '</strong></div>' +
          '<div class="module-row tone-success"><span>success</span><strong>' + outcomes.success + '</strong></div>' +
          '<div class="module-row tone-flaky"><span>flaky</span><strong>' + outcomes.flaky + '</strong></div>' +
          '<div class="module-row tone-fail"><span>failed</span><strong>' + outcomes.failed + '</strong></div>' +
          (legacyTotal
            ? '<div class="module-row"><span>partial logs</span><strong><span class="text-fail">' + legacyFailed + ' failed</span> · <span class="text-flaky">' + legacyFlaky + ' flaky</span> · success not recorded</strong></div>'
            : '') +
          '</div>'
        );
      }

      function renderModuleFilter() {
        const container = document.getElementById('module-filter-options');
        const modules = moduleNames();
        container.innerHTML = modules
          .map(
            (module, index) =>
              '<label class="module-option" for="module-filter-option-' + index + '">' +
              '<input id="module-filter-option-' + index + '" type="checkbox" value="' + escapeHtml(module) + '">' +
              '<span>' + escapeHtml(module) + '</span></label>',
          )
          .join('');

        for (const input of container.querySelectorAll('input[type="checkbox"]')) {
          input.addEventListener('change', () => {
            if (input.checked) {
              state.selectedModules.add(input.value);
            } else {
              state.selectedModules.delete(input.value);
            }
            commitModuleSelection();
          });
        }

        document.getElementById('module-filter-clear').addEventListener('click', () => {
          state.selectedModules.clear();
          commitModuleSelection();
        });
        syncModuleSelectionControls();
      }

      function commitModuleSelection({ scrollToExplorer = false } = {}) {
        syncModuleSelectionControls();
        state.routePage = 1;
        renderRoutes();
        if (scrollToExplorer) {
          document.getElementById('module-filter').open = false;
          const heading = document.getElementById('route-explorer-title');
          heading.focus({ preventScroll: true });
          heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }

      function syncModuleSelectionControls() {
        for (const input of document.querySelectorAll('#module-filter-options input[type="checkbox"]')) {
          input.checked = state.selectedModules.has(input.value);
        }
        updateModuleFilterSummary();
        syncModuleCards();
      }

      function syncModuleCards() {
        const selected = state.selectedModules.size === 1 ? [...state.selectedModules][0] : null;
        for (const button of document.querySelectorAll('.module-filter-trigger')) {
          const active = button.dataset.module === selected;
          button.setAttribute('aria-pressed', String(active));
          button.closest('.module-item').classList.toggle('is-selected', active);
        }
      }

      function updateModuleFilterSummary() {
        const selected = [...state.selectedModules];
        setText(
          'module-filter-summary',
          selected.length === 0 ? 'All modules' : selected.length === 1 ? selected[0] : selected.length + ' modules',
        );
        document.getElementById('module-filter-clear').disabled = selected.length === 0;
      }

      function renderRuns() {
        const body = document.getElementById('runs-body');
        const rows = [...state.runs].sort((left, right) =>
          String(right.completed_at).localeCompare(String(left.completed_at)),
        );
        const pageRows = paginate(rows, state.runPage, state.runPageSize);
        setText('run-count', rangeLabel(rows.length, state.runPage, state.runPageSize) + ' of ' + rows.length + ' inspected runs');
        body.innerHTML = pageRows
          .map(
            (run) =>
              '<tr>' +
              cell('#' + escapeHtml(run.run_number || run.run_id), 'Run') +
              cell(escapeHtml(run.run_attempt), 'Attempt') +
              cell(escapeHtml(run.workflow), 'Workflow') +
              cell(escapeHtml(run.branch), 'Branch') +
              cell(escapeHtml(run.event), 'Event') +
              cell(escapeHtml(formatSource(run.data_source)), 'Source') +
              cell(formatDateTime(run.started_at), 'Started') +
              cell(formatDateTime(run.completed_at), 'Completed') +
              cell('<span class="pill ' + statusTone(run.conclusion) + '">' + escapeHtml(run.conclusion) + '</span>', 'Conclusion') +
              '</tr>',
          )
          .join('');
        renderPagination('runs-pagination', {
          total: rows.length,
          page: state.runPage,
          pageSize: state.runPageSize,
          onPage: (page) => {
            state.runPage = page;
            renderRuns();
          },
        });
      }

      function bindControls() {
        document.getElementById('search').addEventListener('input', () => {
          state.routePage = 1;
          renderRoutes();
        });
        document.getElementById('routes-body').addEventListener('click', (event) => {
          const trigger = event.target.closest('button[data-route-failures]');
          if (trigger) {
            toggleFailureHistory(trigger);
          }
        });
        document.getElementById('route-page-size').addEventListener('input', (event) => {
          state.routePageSize = number(event.target.value) || 50;
          state.routePage = 1;
          renderRoutes();
        });
        document.getElementById('time-range').addEventListener('change', (event) => {
          changeTimeRange(event.target.value);
        });
      }

      async function changeTimeRange(value) {
        const select = document.getElementById('time-range');
        const previousValue = state.timeRange;
        select.disabled = true;
        setText('route-count', 'Loading time range...');
        try {
          if (value === 'all') {
            state.routeStats = state.stats;
            state.routePlatformByRoute = state.platformByRoute;
          } else {
            const data = await loadTimeWindowData();
            const window = data.windows?.[value];
            if (!window) {
              throw new Error('Unknown time range: ' + value);
            }
            state.routeStats = window.routeStats ?? [];
            state.routePlatformByRoute = groupPlatformStats(window.routePlatformStats ?? []);
          }
          state.timeRange = value;
          state.routePage = 1;
          renderRoutes();
        } catch (error) {
          select.value = previousValue;
          setText('route-count', 'Could not load time range: ' + error.message);
        } finally {
          select.disabled = false;
        }
      }

      function loadTimeWindowData() {
        if (!state.timeWindowDataPromise) {
          if (!state.timeWindowFile) {
            return Promise.reject(new Error('Time-window data is unavailable'));
          }
          state.timeWindowDataPromise = fetchJson(state.timeWindowFile).catch((error) => {
            state.timeWindowDataPromise = null;
            throw error;
          });
        }
        return state.timeWindowDataPromise;
      }

      function renderRoutes() {
        const search = document.getElementById('search').value.trim().toLowerCase();
        const body = document.getElementById('routes-body');

        const rows = state.routeStats
          .filter((row) => routeMatches(row, { search, modules: state.selectedModules }))
          .sort(compareSuccessRateRoutes);
        const pageRows = paginate(rows, state.routePage, state.routePageSize);
        setText('route-count', rangeLabel(rows.length, state.routePage, state.routePageSize) + ' of ' + rows.length + ' matching routes');

        if (pageRows.length === 0) {
          const message = state.timeRange === 'all' ? 'No matching routes.' : 'No matching routes in this time range.';
          body.innerHTML = '<tr><td class="empty" colspan="6">' + message + '</td></tr>';
          renderPagination('routes-pagination', {
            total: 0,
            page: 1,
            pageSize: state.routePageSize,
            onPage: () => {},
          });
          return;
        }

        body.innerHTML = pageRows.map(renderRouteRow).join('');
        renderPagination('routes-pagination', {
          total: rows.length,
          page: state.routePage,
          pageSize: state.routePageSize,
          onPage: (page) => {
            state.routePage = page;
            renderRoutes();
          },
        });
      }

      function routeMatches(row, { search, modules }) {
        const haystack = [row.route_id, row.module_tags, row.top_error_signature].join(' ').toLowerCase();

        if (search && !haystack.includes(search)) {
          return false;
        }
        if (modules.size > 0 && !routeModules(row).some((module) => modules.has(module))) {
          return false;
        }
        return true;
      }

      function renderRouteRow(row) {
        const platforms = state.routePlatformByRoute.get(row.route_id) ?? new Map();
        const macos = platforms.get('macos');
        const windows = platforms.get('windows');
        return (
          '<tr data-route-row="' + escapeHtml(row.route_id) + '">' +
          cell(
            '<div class="route-cell">' +
              renderRouteHeading(row.route_id) +
              renderFailureHistoryTrigger(row.route_id) +
              '</div>',
            'Route',
          ) +
          cell(renderTags(row.module_tags), 'Modules') +
          cell(renderRouteHealth(row), 'Historical outcomes') +
          cell('<div class="platform-pair">' + renderPlatformChip('macOS', macos) + renderPlatformChip('Windows', windows) + '</div>', 'Platform detail') +
          cell('<span class="pill ' + statusTone(row.last_outcome) + '">' + escapeHtml(row.last_outcome || 'unknown') + '</span>', 'Latest') +
          cell('<div class="error-line"><span class="error-label">Top error</span>' + escapeHtml(row.top_error_signature || row.last_failed_at || 'None captured') + '</div>', 'Top error') +
          '</tr>'
        );
      }

      function renderFailureHistoryTrigger(routeId) {
        const allTime = state.statsByRoute.get(routeId);
        if (!allTime || number(allTime.failed_runs) === 0) {
          return '';
        }
        return (
          '<div class="failure-history-actions">' +
          '<button type="button" class="failure-history-trigger" data-route-failures data-route-id="' +
          escapeHtml(routeId) +
          '" aria-expanded="false">View failed commits</button>' +
          '</div>'
        );
      }

      async function toggleFailureHistory(trigger) {
        const routeId = trigger.dataset.routeId;
        const routeRow = trigger.closest('tr');
        const current = routeRow.nextElementSibling;
        if (current?.classList.contains('failure-history-detail') && current.dataset.routeId === routeId) {
          current.remove();
          trigger.setAttribute('aria-expanded', 'false');
          return;
        }

        closeFailureHistory();
        const detail = document.createElement('tr');
        detail.className = 'failure-history-detail';
        detail.dataset.routeId = routeId;
        detail.innerHTML =
          '<td colspan="6" data-label="Failed commits">' +
          '<section class="failure-history" aria-live="polite"><span class="muted">Loading failed commits...</span></section>' +
          '</td>';
        routeRow.after(detail);
        trigger.setAttribute('aria-expanded', 'true');

        try {
          const routeHistory = await loadFailureHistory(routeId);
          if (detail.isConnected) {
            detail.firstElementChild.innerHTML = renderFailureHistory(routeHistory);
          }
        } catch (error) {
          if (detail.isConnected) {
            detail.firstElementChild.innerHTML =
              '<section class="failure-history" role="alert"><strong>Could not load failed commits.</strong> ' +
              '<span class="muted">' + escapeHtml(error.message) + '</span></section>';
          }
        }
      }

      function closeFailureHistory() {
        document.querySelector('#routes-body > tr.failure-history-detail')?.remove();
        for (const trigger of document.querySelectorAll('button[data-route-failures][aria-expanded="true"]')) {
          trigger.setAttribute('aria-expanded', 'false');
        }
      }

      async function loadFailureHistory(routeId) {
        if (!state.failureHistoryIndexPromise) {
          if (!state.failureHistoryIndexFile) {
            return Promise.reject(new Error('Failure history data is unavailable'));
          }
          state.failureHistoryIndexPromise = fetchJson(state.failureHistoryIndexFile).catch((error) => {
            state.failureHistoryIndexPromise = null;
            throw error;
          });
        }
        const index = await state.failureHistoryIndexPromise;
        const routeFile = index.routes?.[routeId];
        if (!routeFile) {
          return null;
        }
        if (!state.failureHistoryRoutePromises.has(routeId)) {
          state.failureHistoryRoutePromises.set(
            routeId,
            fetchJson(routeFile).catch((error) => {
              state.failureHistoryRoutePromises.delete(routeId);
              throw error;
            }),
          );
        }
        return state.failureHistoryRoutePromises.get(routeId);
      }

      function renderFailureHistory(routeHistory) {
        const failures = routeHistory?.failures ?? [];
        const countLabel = failures.length + ' failed commit' + (failures.length === 1 ? '' : 's');
        if (failures.length === 0) {
          return (
            '<section class="failure-history">' +
            '<div class="failure-history-heading"><div><h3>Failed commits</h3>' +
            '<p>All time · final failed outcomes only</p></div></div>' +
            '<div class="muted">No failed commits were recorded for this route.</div>' +
            '</section>'
          );
        }
        return (
          '<section class="failure-history">' +
          '<div class="failure-history-heading"><div><h3>Failed commits</h3>' +
          '<p>' + escapeHtml(countLabel) + ' · all time · final failed outcomes only</p></div></div>' +
          '<div class="table-wrap"><table>' +
          '<caption>Commits where this route finished with a failed outcome</caption>' +
          '<thead><tr><th scope="col">Commit</th><th scope="col">PR</th><th scope="col">Platforms</th>' +
          '<th scope="col">Completed</th><th scope="col">CI runs</th><th scope="col">Error evidence</th></tr></thead>' +
          '<tbody>' + failures.map(renderFailureCommit).join('') + '</tbody>' +
          '</table></div></section>'
        );
      }

      function renderFailureCommit(failure) {
        const runs = failure.runs ?? [];
        const latestRun = runs[0] ?? {};
        const sha = String(failure.sha || '');
        const commitLabel = sha ? sha.slice(0, 8) : 'SHA unavailable';
        const commit = sha
          ? '<a href="https://github.com/AOE-HQ/aoe-desktop/commit/' + encodeURIComponent(sha) +
            '" target="_blank" rel="noreferrer">' + escapeHtml(commitLabel) + '</a>'
          : '<span class="muted">' + commitLabel + '</span>';
        const prNumbers = [...new Set(runs.map((run) => run.pr_number).filter(Boolean))].sort(
          (left, right) => number(left) - number(right) || String(left).localeCompare(String(right)),
        );
        const isPullRequest = runs.some((run) => run.event === 'pull_request');
        const pr = prNumbers.length
          ? '<div class="failure-history-links">' +
            prNumbers
              .map(
                (prNumber) =>
                  '<a href="https://github.com/AOE-HQ/aoe-desktop/pull/' + encodeURIComponent(prNumber) +
                  '" target="_blank" rel="noreferrer">#' + escapeHtml(prNumber) + '</a>',
              )
              .join('') +
            '</div>'
          : '<span class="muted">' + (isPullRequest ? 'Not recorded' : 'Not a PR run') + '</span>';
        const platforms = [
          ...new Set(runs.flatMap((run) => (run.platforms ?? []).map((platform) => platform.platform))),
        ]
          .sort((left, right) => left.localeCompare(right))
          .map(platformLabel)
          .join(' · ');
        const runLinks = runs
          .map((run) => {
            const label = 'Run #' + (run.run_number || run.run_id) + (run.attempt && run.attempt !== '1' ? ' attempt ' + run.attempt : '');
            return (
              '<a href="https://github.com/AOE-HQ/aoe-desktop/actions/runs/' + encodeURIComponent(run.run_id) +
              '" target="_blank" rel="noreferrer">' + escapeHtml(label) + '</a>'
            );
          })
          .join('');
        const errors = [
          ...new Set(
            runs.flatMap((run) =>
              (run.platforms ?? []).map((platform) => platform.error_signature).filter(Boolean),
            ),
          ),
        ];
        return (
          '<tr data-failure-commit>' +
          cell(commit + '<div class="metric-note">' + escapeHtml(latestRun.branch || 'unknown branch') + '</div>', 'Commit') +
          cell(pr, 'PR') +
          cell(escapeHtml(platforms || 'unknown'), 'Platforms') +
          cell(formatDateTime(failure.completed_at), 'Completed') +
          cell('<div class="failure-history-links">' + runLinks + '</div>', 'CI runs') +
          cell('<div class="failure-history-error">' + escapeHtml(errors.join(' · ') || 'None captured') + '</div>', 'Error evidence') +
          '</tr>'
        );
      }

      function renderRouteHealth(row) {
        const hasFull = number(row.full_runs) > 0 && row.pass_rate !== '';
        const passRate = hasFull ? number(row.pass_rate) : null;
        const partial = legacyPartial(row);
        return (
          '<div class="health health-block">' +
          '<div><div class="health-title"><span>Complete logs</span><strong>' +
          (passRate === null ? 'n/a' : formatPercent(passRate)) +
          '</strong></div>' +
          renderFullBar(row) +
          '<div class="metric-note">' +
          number(row.full_runs) +
          ' complete · ' +
          '<span class="text-success">' + cleanPassed(row) + ' success</span> · ' +
          '<span class="text-flaky">' + number(row.full_flaky_runs) + ' flaky</span> · ' +
          '<span class="text-fail">' + number(row.full_failed_runs) + ' failed</span></div>' +
          renderPartialLogNote(partial) +
          '</div></div>'
        );
      }

      function renderPlatformChip(label, row) {
        if (!row) {
          return '<div class="platform-chip"><strong>' + label + '</strong><span class="muted">no data</span></div>';
        }
        const partial = legacyPartial(row);
        return (
          '<div class="platform-chip">' +
          '<strong>' + label + '</strong>' +
          '<span class="metric-note">Latest </span><span class="pill ' + statusTone(row.last_outcome) + '">' + escapeHtml(row.last_outcome || 'unknown') + '</span>' +
          '<div class="metric-note">Complete logs: ' +
          (row.pass_rate === '' ? 'n/a' : formatPercent(number(row.pass_rate))) +
          ' · ' +
          number(row.full_runs) +
          ' obs · ' +
          '<span class="text-success">' + cleanPassed(row) + ' success</span> · ' +
          '<span class="text-flaky">' + number(row.full_flaky_runs) + ' flaky</span> · ' +
          '<span class="text-fail">' + number(row.full_failed_runs) + ' failed</span></div>' +
          renderPartialLogNote(partial) +
          '</div>'
        );
      }

      function summarizePlatformStats() {
        const summaries = new Map();
        for (const row of state.platformStats) {
          const platform = row.platform || 'unknown';
          const summary = summaries.get(platform) ?? emptyPlatformSummary(platform);
          summary.fullTotal += number(row.full_runs);
          summary.fullFailed += number(row.full_failed_runs);
          summary.fullFlaky += number(row.full_flaky_runs);
          summary.fullPassed += Math.max(
            0,
            number(row.full_runs) - number(row.full_failed_runs) - number(row.full_flaky_runs),
          );
          summary.logSignals += number(row.log_signal_runs);
          summary.logFailed += number(row.log_failed_runs);
          summary.logFlaky += number(row.log_flaky_runs);
          summary.attemptFailures += number(row.attempt_failures);
          summaries.set(platform, summary);
        }
        return summaries;
      }

      function emptyPlatformSummary(platform) {
        return {
          platform,
          total: 0,
          fullTotal: 0,
          fullPassed: 0,
          fullFailed: 0,
          fullFlaky: 0,
          logSignals: 0,
          logFailed: 0,
          logFlaky: 0,
          attemptFailures: 0,
        };
      }

      function groupPlatformStats(rows) {
        const byRoute = new Map();
        for (const row of rows) {
          if (!byRoute.has(row.route_id)) {
            byRoute.set(row.route_id, new Map());
          }
          byRoute.get(row.route_id).set(row.platform, row);
        }
        return byRoute;
      }

      function moduleNames() {
        return [...new Set(state.stats.flatMap(routeModules))].sort((left, right) => left.localeCompare(right));
      }

      function routeModules(route) {
        const modules = parseModuleTags(route.module_tags);
        return modules.length > 0 ? modules : ['untagged'];
      }

      function parseModuleTags(value) {
        return String(value || '')
          .split(';')
          .map((tag) => tag.trim())
          .filter(Boolean);
      }

      function moduleSummaries() {
        const modules = new Map();
        for (const route of state.stats) {
          for (const tag of routeModules(route)) {
            const summary =
              modules.get(tag) ?? {
                name: tag,
                routes: 0,
                full: 0,
                fullFailed: 0,
                fullFlaky: 0,
                logFailed: 0,
                logFlaky: 0,
                log: 0,
                attempts: 0,
              };
            const fullRuns = number(route.full_runs);
            summary.routes += 1;
            summary.full += fullRuns;
            summary.fullFailed += number(route.full_failed_runs);
            summary.fullFlaky += number(route.full_flaky_runs);
            summary.logFailed += number(route.log_failed_runs);
            summary.logFlaky += number(route.log_flaky_runs);
            summary.log += number(route.log_signal_runs);
            summary.attempts += number(route.attempt_failures);
            modules.set(tag, summary);
          }
        }
        return [...modules.values()].sort(
          (left, right) =>
            right.logFailed - left.logFailed ||
            right.logFlaky - left.logFlaky ||
            right.fullFailed - left.fullFailed ||
            right.attempts - left.attempts ||
            left.name.localeCompare(right.name),
        );
      }

      function latestRun() {
        return [...state.runs].sort((left, right) =>
          String(right.completed_at).localeCompare(String(left.completed_at)),
        )[0];
      }

      function compareRiskRoutes(left, right) {
        return (
          failureSignals(right) - failureSignals(left) ||
          flakySignals(right) - flakySignals(left) ||
          number(right.attempt_failures) - number(left.attempt_failures) ||
          compareSuccessRateRoutes(left, right)
        );
      }

      function compareSuccessRateRoutes(left, right) {
        return passRateSortValue(left) - passRateSortValue(right) || routeCompare(left, right);
      }

      function renderOutcomeBar(summary) {
        if (!summary.fullTotal) {
          return '<div class="bar" role="img" aria-label="No complete log outcomes"><span class="bar-skip" style="width:100%"></span></div>';
        }
        return (
          '<div class="bar" role="img" aria-label="' + summary.fullPassed + ' success, ' + summary.fullFlaky + ' flaky, ' + summary.fullFailed + ' failed">' +
          '<span class="bar-pass" style="width:' + proportion(summary.fullPassed, summary.fullTotal) + '%"></span>' +
          '<span class="bar-flaky" style="width:' + proportion(summary.fullFlaky, summary.fullTotal) + '%"></span>' +
          '<span class="bar-fail" style="width:' + proportion(summary.fullFailed, summary.fullTotal) + '%"></span>' +
          '</div>'
        );
      }

      function renderFullBar(row) {
        const total = number(row.full_runs);
        if (!total) {
          return '<div class="bar" role="img" aria-label="No complete log outcomes"><span class="bar-skip" style="width:100%"></span></div>';
        }
        const passed = cleanPassed(row);
        return (
          '<div class="bar" role="img" aria-label="' + passed + ' success, ' + number(row.full_flaky_runs) + ' flaky, ' + number(row.full_failed_runs) + ' failed"><span class="bar-pass" style="width:' +
          proportion(passed, total) +
          '%"></span><span class="bar-flaky" style="width:' +
          proportion(number(row.full_flaky_runs), total) +
          '%"></span><span class="bar-fail" style="width:' +
          proportion(number(row.full_failed_runs), total) +
          '%"></span></div>'
        );
      }

      function renderModuleBar(module) {
        if (!module.total) {
          return '<div class="bar" role="img" aria-label="No known log outcomes"><span class="bar-skip" style="width:100%"></span></div>';
        }
        return (
          '<div class="bar" role="img" aria-label="' + module.success + ' success, ' + module.flaky + ' flaky, ' + module.failed + ' failed">' +
          '<span class="bar-pass" style="width:' + proportion(module.success, module.total) + '%"></span>' +
          '<span class="bar-flaky" style="width:' + proportion(module.flaky, module.total) + '%"></span>' +
          '<span class="bar-fail" style="width:' + proportion(module.failed, module.total) + '%"></span>' +
          '</div>'
        );
      }

      function moduleOutcomeCounts(module) {
        const success = Math.max(0, module.full - module.fullFailed - module.fullFlaky);
        const flaky = module.logFlaky;
        const failed = module.logFailed;
        return { success, flaky, failed, total: success + flaky + failed };
      }

      function renderTags(value) {
        const tags = parseModuleTags(value);
        if (tags.length === 0) {
          return '<span class="muted">none</span>';
        }
        return '<div class="tag-list">' + tags.map((tag) => '<span class="tag">' + escapeHtml(tag) + '</span>').join('') + '</div>';
      }

      function miniStat(label, value, tone = '') {
        return '<div class="mini-stat ' + tone + '"><span>' + label + '</span><strong>' + value + '</strong></div>';
      }

      function routeCompare(left, right) {
        return String(left.route_id).localeCompare(String(right.route_id));
      }

      function platformLabel(platform) {
        if (platform === 'macos') {
          return 'macOS';
        }
        if (platform === 'windows') {
          return 'Windows';
        }
        return platform || 'Unknown';
      }

      function failureSignals(row) {
        return number(row.log_failed_runs);
      }

      function flakySignals(row) {
        return number(row.log_flaky_runs);
      }

      function passRateSortValue(row) {
        return row.pass_rate === '' ? 2 : number(row.pass_rate);
      }

      function cleanPassed(row) {
        return Math.max(
          0,
          number(row.full_runs) - number(row.full_failed_runs) - number(row.full_flaky_runs),
        );
      }

      function legacyPartial(row) {
        return {
          failed: Math.max(0, number(row.log_failed_runs) - number(row.full_failed_runs)),
          flaky: Math.max(0, number(row.log_flaky_runs) - number(row.full_flaky_runs)),
          total: Math.max(0, number(row.log_signal_runs) - number(row.full_runs)),
        };
      }

      function renderPartialLogNote(partial) {
        if (!partial.total) {
          return '';
        }
        return (
          '<div class="metric-note">Partial logs: ' +
          '<span class="text-fail">' + partial.failed + ' failed</span> · ' +
          '<span class="text-flaky">' + partial.flaky + ' flaky</span> · success not recorded</div>'
        );
      }

      function statusTone(value) {
        const status = String(value || '').toLowerCase();
        if (status === 'failure' || status === 'failed') {
          return 'tone-fail';
        }
        if (status === 'flaky') {
          return 'tone-flaky';
        }
        if (status === 'success' || status === 'passed') {
          return 'tone-success';
        }
        return 'tone-neutral';
      }

      function renderRouteHeading(routeId) {
        const [specFile, ...titleParts] = String(routeId || '').split(' :: ');
        const title = titleParts.join(' :: ') || specFile;
        return (
          '<div class="route-heading">' +
          '<span class="route-spec">' + escapeHtml(specFile) + '</span>' +
          '<span class="route-title">' + escapeHtml(title) + '</span>' +
          '</div>'
        );
      }

      function paginate(rows, page, pageSize) {
        const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
        const safePage = Math.max(1, Math.min(page, totalPages));
        const start = (safePage - 1) * pageSize;
        return rows.slice(start, start + pageSize);
      }

      function rangeLabel(total, page, pageSize) {
        if (!total) {
          return '0';
        }
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.max(1, Math.min(page, totalPages));
        const start = (safePage - 1) * pageSize + 1;
        const end = Math.min(total, start + pageSize - 1);
        return start + '-' + end;
      }

      function renderPagination(containerId, { total, page, pageSize, onPage }) {
        const container = document.getElementById(containerId);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.max(1, Math.min(page, totalPages));
        container.innerHTML =
          '<button type="button" data-page="' +
          (safePage - 1) +
          '"' +
          (safePage <= 1 ? ' disabled' : '') +
          '>Previous</button>' +
          '<span>Page ' +
          safePage +
          ' / ' +
          totalPages +
          '</span>' +
          '<button type="button" data-page="' +
          (safePage + 1) +
          '"' +
          (safePage >= totalPages ? ' disabled' : '') +
          '>Next</button>';
        for (const button of container.querySelectorAll('button[data-page]')) {
          button.addEventListener('click', () => {
            const nextPage = number(button.getAttribute('data-page'));
            if (nextPage >= 1 && nextPage <= totalPages) {
              onPage(nextPage);
            }
          });
        }
      }

      function formatSource(value) {
        const source = String(value || '');
        if (!source) {
          return 'unknown';
        }
        return source
          .split(';')
          .map((item) => {
            if (item === 'artifact_json') {
              return 'route catalog JSON only';
            }
            if (item === 'job_log_route_metric') {
              return 'job log route metrics';
            }
            if (item === 'job_log_failure_summary') {
              return 'legacy job log summary';
            }
            if (item === 'inspected_ci') {
              return 'inspected';
            }
            if (item === 'unavailable_job_log') {
              return 'log unavailable';
            }
            return item || 'unknown';
          })
          .join(' + ');
      }

      function proportion(value, total) {
        return total ? clampPercent(value / total) : 0;
      }

      function clampPercent(value) {
        return Math.max(0, Math.min(100, Number(value) * 100)).toFixed(2);
      }

      function number(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      }

      function sum(values) {
        return values.reduce((total, value) => total + value, 0);
      }

      function formatPercent(value) {
        return (value * 100).toFixed(2) + '%';
      }

      function formatDateTime(value) {
        if (!value) {
          return '';
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
          return value;
        }
        return date.toISOString().replace('T', ' ').replace('.000Z', 'Z');
      }

      function cell(value, label = '') {
        return '<td data-label="' + escapeHtml(label) + '">' + value + '</td>';
      }

      function setText(id, value) {
        document.getElementById(id).textContent = String(value);
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#039;');
      }

    </script>
  </body>
</html>
`;
}
