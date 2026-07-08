#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const distDir = path.join(repoRoot, 'dist');
const dataDir = path.join(repoRoot, 'data');
const distDataDir = path.join(distDir, 'data');

const csvFiles = ['routes.csv', 'runs.csv', 'route_results.csv', 'route_stats.csv', 'route_platform_stats.csv'];

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDataDir, { recursive: true });

for (const fileName of csvFiles) {
  copyFileSync(path.join(dataDir, fileName), path.join(distDataDir, fileName));
}

writeFileSync(path.join(distDir, '.nojekyll'), '');
writeFileSync(path.join(distDir, 'manifest.json'), `${JSON.stringify(buildManifest(), null, 2)}\n`);
writeFileSync(path.join(distDir, 'index.html'), buildIndexHtml());

function buildManifest() {
  const files = Object.fromEntries(
    csvFiles.map((fileName) => {
      const content = readFileSync(path.join(dataDir, fileName), 'utf8');
      const lineCount = content.trim() ? content.trimEnd().split(/\r?\n/).length : 0;
      return [fileName, { line_count: lineCount, data_rows: Math.max(0, lineCount - 1) }];
    }),
  );

  return {
    generated_at: new Date().toISOString(),
    files,
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
        --bg: #eef2f6;
        --panel: #ffffff;
        --line: #d8e0ea;
        --line-soft: #e8edf3;
        --text: #152033;
        --muted: #647084;
        --teal: #0f766e;
        --blue: #2563eb;
        --red: #b42318;
        --amber: #b54708;
        --green: #16703c;
        --violet: #6d28d9;
        --shadow: 0 1px 2px rgba(20, 31, 48, 0.08), 0 12px 36px rgba(20, 31, 48, 0.06);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.45;
        overflow-x: hidden;
      }

      a {
        color: var(--teal);
      }

      .shell {
        width: min(1480px, calc(100% - 32px));
        margin: 0 auto;
        padding: 28px 0 44px;
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
        font-size: clamp(30px, 4vw, 46px);
        line-height: 1.05;
        letter-spacing: 0;
      }

      h2 {
        margin: 0;
        font-size: 18px;
        letter-spacing: 0;
      }

      .subtitle {
        margin: 0;
        color: var(--muted);
        max-width: 780px;
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
        border-radius: 6px;
        background: var(--panel);
        color: var(--text);
        text-decoration: none;
        font-size: 13px;
        font-weight: 700;
        white-space: nowrap;
      }

      .hero-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.3fr) minmax(320px, 0.7fr);
        gap: 14px;
      }

      .scoreboard {
        display: grid;
        grid-template-columns: repeat(5, minmax(120px, 1fr));
        gap: 10px;
      }

      .metric,
      .panel,
      .risk-card,
      .platform-card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: var(--shadow);
      }

      .metric {
        min-height: 116px;
        padding: 15px;
      }

      .metric-label {
        color: var(--muted);
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
      }

      .metric-value {
        margin-top: 8px;
        font-size: 30px;
        font-weight: 850;
        line-height: 1.05;
      }

      .metric-note {
        margin-top: 5px;
        color: var(--muted);
        font-size: 12px;
      }

      .panel {
        margin-top: 14px;
        padding: 16px;
        min-width: 0;
      }

      .panel-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 12px;
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
        background: var(--amber);
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

      .risk-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }

      .risk-card {
        padding: 13px;
        min-width: 0;
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

      .pill.failed {
        background: #fee4df;
        color: var(--red);
      }

      .pill.flaky {
        background: #fff1d6;
        color: var(--amber);
      }

      .pill.passed,
      .pill.success {
        background: #dcf5e6;
        color: var(--green);
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

      .controls {
        display: grid;
        grid-template-columns: minmax(260px, 1fr) 170px 170px 170px;
        gap: 10px;
        margin-bottom: 12px;
      }

      input,
      select {
        width: 100%;
        min-height: 38px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #ffffff;
        color: var(--text);
        padding: 0 10px;
        font: inherit;
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

      tbody tr:hover {
        background: #f9fbfd;
      }

      .route-cell {
        min-width: 440px;
        max-width: 680px;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .health {
        min-width: 150px;
      }

      .health .bar {
        height: 8px;
        margin-top: 6px;
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
        border: 1px solid var(--line-soft);
        border-radius: 8px;
        padding: 12px;
        background: #fbfcfd;
      }

      .module-item strong {
        display: block;
        margin-bottom: 8px;
        font-size: 15px;
      }

      .module-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        color: var(--muted);
        font-size: 12px;
      }

      .empty {
        padding: 26px;
        color: var(--muted);
        text-align: center;
      }

      @media (max-width: 1180px) {
        .hero-grid,
        .risk-grid,
        .module-grid {
          grid-template-columns: 1fr 1fr;
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

        table {
          min-width: 0;
          table-layout: fixed;
        }

        thead {
          display: none;
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

        .route-cell,
        .health,
        .platform-pair {
          min-width: 0;
          max-width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header>
        <div>
          <h1>AoE Desktop E2E CI Metrics</h1>
          <p class="subtitle">Route-level Playwright E2E outcomes from AoE Desktop GitHub CI, with platform-specific aggregation for macOS and Windows.</p>
        </div>
        <nav class="actions" aria-label="CSV downloads">
          <a class="button" href="data/routes.csv">routes</a>
          <a class="button" href="data/runs.csv">runs</a>
          <a class="button" href="data/route_results.csv">results</a>
          <a class="button" href="data/route_stats.csv">route stats</a>
          <a class="button" href="data/route_platform_stats.csv">platform stats</a>
        </nav>
      </header>

      <section class="hero-grid">
        <div class="scoreboard" aria-label="Summary metrics">
          <div class="metric"><div class="metric-label">Imported Runs</div><div id="metric-runs" class="metric-value">...</div><div id="metric-runs-note" class="metric-note">Loading</div></div>
          <div class="metric"><div class="metric-label">Route Observations</div><div id="metric-observations" class="metric-value">...</div><div class="metric-note">per run and platform</div></div>
          <div class="metric"><div class="metric-label">Failing Routes</div><div id="metric-failing" class="metric-value">...</div><div class="metric-note">final failures</div></div>
          <div class="metric"><div class="metric-label">Flaky Routes</div><div id="metric-flaky" class="metric-value">...</div><div class="metric-note">retry recovered</div></div>
          <div class="metric"><div class="metric-label">Avg Pass Rate</div><div id="metric-pass-rate" class="metric-value">...</div><div class="metric-note">weighted by observations</div></div>
        </div>
        <section class="panel" style="margin-top: 0">
          <div class="panel-heading">
            <h2>Latest Run</h2>
            <span id="generated-at" class="muted">Loading</span>
          </div>
          <div id="latest-run"></div>
        </section>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <h2>Platform Health</h2>
          <span class="muted">macOS and Windows are aggregated independently</span>
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
          <span id="module-count" class="muted">Loading</span>
        </div>
        <div id="module-grid" class="module-grid"></div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <h2>Route Explorer</h2>
          <span id="route-count" class="muted">Loading</span>
        </div>
        <div class="controls">
          <input id="search" type="search" placeholder="Search route, module, or error" aria-label="Search routes">
          <select id="filter" aria-label="Filter route health">
            <option value="all">All routes</option>
            <option value="failed">Final failures</option>
            <option value="flaky">Flaky routes</option>
            <option value="attempts">Attempt failures</option>
          </select>
          <select id="platform" aria-label="Filter platform">
            <option value="all">All platforms</option>
            <option value="macos">macOS signal</option>
            <option value="windows">Windows signal</option>
          </select>
          <select id="sort" aria-label="Sort routes">
            <option value="risk">Sort by risk</option>
            <option value="failed">Sort by failures</option>
            <option value="flaky">Sort by flaky</option>
            <option value="passRate">Sort by pass rate</option>
            <option value="route">Sort by route</option>
          </select>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Route</th>
                <th>Modules</th>
                <th>Health</th>
                <th>Platform Detail</th>
                <th>Last</th>
                <th>Top Error</th>
              </tr>
            </thead>
            <tbody id="routes-body"></tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <h2>Imported Runs</h2>
          <span id="run-count" class="muted">Loading</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Attempt</th>
                <th>Workflow</th>
                <th>Branch</th>
                <th>Event</th>
                <th>Started</th>
                <th>Completed</th>
                <th>Conclusion</th>
              </tr>
            </thead>
            <tbody id="runs-body"></tbody>
          </table>
        </div>
      </section>
    </main>

    <script>
      const files = {
        manifest: 'manifest.json',
        runs: 'data/runs.csv',
        stats: 'data/route_stats.csv',
        platformStats: 'data/route_platform_stats.csv',
        results: 'data/route_results.csv',
      };

      const state = {
        runs: [],
        stats: [],
        platformStats: [],
        results: [],
        platformByRoute: new Map(),
      };

      Promise.all([
        fetchJson(files.manifest),
        fetchCsv(files.runs),
        fetchCsv(files.stats),
        fetchCsv(files.platformStats),
        fetchCsv(files.results),
      ])
        .then(([manifest, runs, stats, platformStats, results]) => {
          state.runs = runs;
          state.stats = stats;
          state.platformStats = platformStats;
          state.results = results;
          state.platformByRoute = groupPlatformStats(platformStats);
          renderSummary(manifest);
          renderPlatformHealth();
          renderRiskCards();
          renderModules();
          renderRuns();
          bindControls();
          renderRoutes();
        })
        .catch((error) => {
          document.querySelector('.shell').insertAdjacentHTML(
            'afterbegin',
            '<div class="panel"><strong>Failed to load metrics.</strong><br><span class="muted">' +
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
        const totalRoutes = state.stats.length;
        const totalObservations = state.results.length;
        const failingRoutes = state.stats.filter((row) => number(row.failed_runs) > 0).length;
        const flakyRoutes = state.stats.filter((row) => number(row.flaky_runs) > 0).length;
        const totalNonSkipped = sum(state.stats.map((row) => number(row.total_runs)));
        const totalFailures = sum(state.stats.map((row) => number(row.failed_runs)));
        const passRate = totalNonSkipped ? (totalNonSkipped - totalFailures) / totalNonSkipped : 0;
        const lastRun = latestRun();

        setText('metric-runs', state.runs.length);
        setText('metric-runs-note', totalRoutes + ' stable routes imported');
        setText('metric-observations', totalObservations);
        setText('metric-failing', failingRoutes);
        setText('metric-flaky', flakyRoutes);
        setText('metric-pass-rate', formatPercent(passRate));
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
          '<div class="metric-value status ' + escapeAttr(run.conclusion) + '">' + escapeHtml(run.conclusion || 'unknown') + '</div>' +
          '<div class="metric-note">' + escapeHtml(run.branch || 'unknown branch') + ' · ' + escapeHtml(run.event || 'unknown event') + '</div>' +
          '<div class="metric-note">Completed ' + formatDateTime(run.completed_at) + '</div>';
      }

      function renderPlatformHealth() {
        const cards = document.getElementById('platform-cards');
        const summaries = summarizeResultsByPlatform();
        const preferred = ['macos', 'windows'];
        cards.innerHTML = preferred
          .map((platform) => renderPlatformCard(platform, summaries.get(platform) ?? emptyPlatformSummary(platform)))
          .join('');
      }

      function renderPlatformCard(platform, summary) {
        const observed = summary.passed + summary.flaky + summary.failed + summary.skipped;
        const passRate = summary.total ? (summary.total - summary.failed) / summary.total : 0;
        return (
          '<article class="platform-card">' +
          '<div class="platform-title"><strong>' + platformLabel(platform) + '</strong><span class="pill ' + healthClass(summary) + '">' + formatPercent(passRate) + '</span></div>' +
          renderOutcomeBar(summary, observed) +
          '<div class="platform-stats">' +
          miniStat('Passed', summary.passed) +
          miniStat('Flaky', summary.flaky) +
          miniStat('Failed', summary.failed) +
          miniStat('Skipped', summary.skipped) +
          '</div>' +
          '<div class="metric-note">' + summary.attemptFailures + ' raw failed attempts across ' + summary.total + ' non-skipped results</div>' +
          '</article>'
        );
      }

      function renderRiskCards() {
        const container = document.getElementById('risk-cards');
        const rows = [...state.stats].sort(compareRoutes('risk')).slice(0, 6);
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
          '<div class="route-title">' + escapeHtml(row.route_id) + '</div>' +
          '<div class="risk-meta">' +
          '<span class="pill failed">' + number(row.failed_runs) + ' failed</span>' +
          '<span class="pill flaky">' + number(row.flaky_runs) + ' flaky</span>' +
          '<span class="pill">' + number(row.attempt_failures) + ' attempts</span>' +
          '</div>' +
          renderTags(row.module_tags) +
          '<div class="platform-pair" style="margin-top: 10px">' +
          renderPlatformChip('macOS', macos) +
          renderPlatformChip('Windows', windows) +
          '</div>' +
          '<div class="error-line" style="margin-top: 10px">' + escapeHtml(row.top_error_signature || row.last_failed_at || 'No captured error signature') + '</div>' +
          '</article>'
        );
      }

      function renderModules() {
        const modules = moduleSummaries().slice(0, 12);
        setText('module-count', modules.length + ' modules shown');
        document.getElementById('module-grid').innerHTML = modules.map(renderModule).join('');
      }

      function renderModule(module) {
        const passRate = module.total ? (module.total - module.failed) / module.total : 0;
        return (
          '<div class="module-item">' +
          '<strong>' + escapeHtml(module.name) + '</strong>' +
          '<div class="bar">' +
          '<span class="bar-pass" style="width:' + clampPercent(passRate) + '%"></span>' +
          '<span class="bar-fail" style="width:' + clampPercent(1 - passRate) + '%"></span>' +
          '</div>' +
          '<div class="module-row"><span>routes</span><strong>' + module.routes + '</strong></div>' +
          '<div class="module-row"><span>failed</span><strong>' + module.failed + '</strong></div>' +
          '<div class="module-row"><span>flaky</span><strong>' + module.flaky + '</strong></div>' +
          '<div class="module-row"><span>pass rate</span><strong>' + formatPercent(passRate) + '</strong></div>' +
          '</div>'
        );
      }

      function renderRuns() {
        const body = document.getElementById('runs-body');
        const rows = [...state.runs].sort((left, right) =>
          String(right.completed_at).localeCompare(String(left.completed_at)),
        );
        setText('run-count', rows.length + ' imported runs');
        body.innerHTML = rows
          .map(
            (run) =>
              '<tr>' +
              cell('#' + escapeHtml(run.run_number || run.run_id)) +
              cell(escapeHtml(run.run_attempt)) +
              cell(escapeHtml(run.workflow)) +
              cell(escapeHtml(run.branch)) +
              cell(escapeHtml(run.event)) +
              cell(formatDateTime(run.started_at)) +
              cell(formatDateTime(run.completed_at)) +
              cell('<span class="pill ' + escapeAttr(run.conclusion) + '">' + escapeHtml(run.conclusion) + '</span>') +
              '</tr>',
          )
          .join('');
      }

      function bindControls() {
        for (const id of ['search', 'filter', 'platform', 'sort']) {
          document.getElementById(id).addEventListener('input', renderRoutes);
        }
      }

      function renderRoutes() {
        const search = document.getElementById('search').value.trim().toLowerCase();
        const filter = document.getElementById('filter').value;
        const platform = document.getElementById('platform').value;
        const sort = document.getElementById('sort').value;
        const body = document.getElementById('routes-body');

        let rows = state.stats.filter((row) => routeMatches(row, { search, filter, platform }));
        rows = rows.sort(compareRoutes(sort)).slice(0, 500);
        setText('route-count', rows.length + ' shown of ' + state.stats.length);

        if (rows.length === 0) {
          body.innerHTML = '<tr><td class="empty" colspan="6">No matching routes.</td></tr>';
          return;
        }

        body.innerHTML = rows.map(renderRouteRow).join('');
      }

      function routeMatches(row, { search, filter, platform }) {
        const haystack = [row.route_id, row.module_tags, row.top_error_signature].join(' ').toLowerCase();
        const platforms = state.platformByRoute.get(row.route_id) ?? new Map();
        const selectedPlatform = platform === 'all' ? null : platforms.get(platform);

        if (search && !haystack.includes(search)) {
          return false;
        }
        if (platform !== 'all' && !selectedPlatform) {
          return false;
        }
        const target = selectedPlatform ?? row;
        if (filter === 'failed') {
          return number(target.failed_runs) > 0;
        }
        if (filter === 'flaky') {
          return number(target.flaky_runs) > 0;
        }
        if (filter === 'attempts') {
          return number(target.attempt_failures) > 0;
        }
        return true;
      }

      function renderRouteRow(row) {
        const platforms = state.platformByRoute.get(row.route_id) ?? new Map();
        const macos = platforms.get('macos');
        const windows = platforms.get('windows');
        const passRate = number(row.pass_rate);
        return (
          '<tr>' +
          cell('<div class="route-cell"><strong>' + escapeHtml(row.route_id) + '</strong></div>') +
          cell(renderTags(row.module_tags)) +
          cell(
            '<div class="health"><strong>' +
              formatPercent(passRate) +
              '</strong><div class="bar"><span class="bar-pass" style="width:' +
              clampPercent(passRate) +
              '%"></span><span class="bar-fail" style="width:' +
              clampPercent(1 - passRate) +
              '%"></span></div><div class="metric-note">' +
              number(row.failed_runs) +
              ' failed · ' +
              number(row.flaky_runs) +
              ' flaky</div></div>',
          ) +
          cell('<div class="platform-pair">' + renderPlatformChip('macOS', macos) + renderPlatformChip('Windows', windows) + '</div>') +
          cell('<span class="pill ' + escapeAttr(row.last_outcome) + '">' + escapeHtml(row.last_outcome || 'unknown') + '</span>') +
          cell('<div class="error-line">' + escapeHtml(row.top_error_signature || row.last_failed_at || '') + '</div>') +
          '</tr>'
        );
      }

      function renderPlatformChip(label, row) {
        if (!row) {
          return '<div class="platform-chip"><strong>' + label + '</strong><span class="muted">no data</span></div>';
        }
        return (
          '<div class="platform-chip">' +
          '<strong>' + label + '</strong>' +
          '<span class="pill ' + escapeAttr(row.last_outcome) + '">' + escapeHtml(row.last_outcome || 'unknown') + '</span>' +
          '<div class="metric-note">' +
          number(row.failed_runs) +
          'F · ' +
          number(row.flaky_runs) +
          'Fl · ' +
          formatPercent(number(row.pass_rate)) +
          '</div>' +
          '</div>'
        );
      }

      function summarizeResultsByPlatform() {
        const summaries = new Map();
        for (const result of state.results) {
          const platform = result.platform || 'unknown';
          const summary = summaries.get(platform) ?? emptyPlatformSummary(platform);
          summary[result.outcome] = (summary[result.outcome] ?? 0) + 1;
          summary.attemptFailures += number(result.attempt_failures);
          if (result.outcome !== 'skipped') {
            summary.total += 1;
          }
          summaries.set(platform, summary);
        }
        return summaries;
      }

      function emptyPlatformSummary(platform) {
        return {
          platform,
          total: 0,
          passed: 0,
          failed: 0,
          flaky: 0,
          skipped: 0,
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

      function moduleSummaries() {
        const modules = new Map();
        for (const route of state.stats) {
          const tags = String(route.module_tags || 'untagged').split(';').filter(Boolean);
          for (const tag of tags.length ? tags : ['untagged']) {
            const summary = modules.get(tag) ?? { name: tag, routes: 0, total: 0, failed: 0, flaky: 0, attempts: 0 };
            summary.routes += 1;
            summary.total += number(route.total_runs);
            summary.failed += number(route.failed_runs);
            summary.flaky += number(route.flaky_runs);
            summary.attempts += number(route.attempt_failures);
            modules.set(tag, summary);
          }
        }
        return [...modules.values()].sort(
          (left, right) =>
            right.failed - left.failed ||
            right.flaky - left.flaky ||
            right.attempts - left.attempts ||
            left.name.localeCompare(right.name),
        );
      }

      function latestRun() {
        return [...state.runs].sort((left, right) =>
          String(right.completed_at).localeCompare(String(left.completed_at)),
        )[0];
      }

      function compareRoutes(sort) {
        return (left, right) => {
          if (sort === 'failed') {
            return number(right.failed_runs) - number(left.failed_runs) || routeCompare(left, right);
          }
          if (sort === 'flaky') {
            return number(right.flaky_runs) - number(left.flaky_runs) || routeCompare(left, right);
          }
          if (sort === 'passRate') {
            return number(left.pass_rate) - number(right.pass_rate) || routeCompare(left, right);
          }
          if (sort === 'route') {
            return routeCompare(left, right);
          }
          return (
            number(right.failed_runs) - number(left.failed_runs) ||
            number(right.flaky_runs) - number(left.flaky_runs) ||
            number(right.attempt_failures) - number(left.attempt_failures) ||
            number(left.pass_rate) - number(right.pass_rate) ||
            routeCompare(left, right)
          );
        };
      }

      function renderOutcomeBar(summary, observed) {
        if (!observed) {
          return '<div class="bar"><span class="bar-skip" style="width:100%"></span></div>';
        }
        return (
          '<div class="bar">' +
          '<span class="bar-pass" style="width:' + proportion(summary.passed, observed) + '%"></span>' +
          '<span class="bar-flaky" style="width:' + proportion(summary.flaky, observed) + '%"></span>' +
          '<span class="bar-fail" style="width:' + proportion(summary.failed, observed) + '%"></span>' +
          '<span class="bar-skip" style="width:' + proportion(summary.skipped, observed) + '%"></span>' +
          '</div>'
        );
      }

      function renderTags(value) {
        const tags = String(value || '').split(';').filter(Boolean);
        if (tags.length === 0) {
          return '<span class="muted">none</span>';
        }
        return '<div class="tag-list">' + tags.map((tag) => '<span class="tag">' + escapeHtml(tag) + '</span>').join('') + '</div>';
      }

      function miniStat(label, value) {
        return '<div class="mini-stat"><span>' + label + '</span><strong>' + value + '</strong></div>';
      }

      function routeCompare(left, right) {
        return String(left.route_id).localeCompare(String(right.route_id));
      }

      function healthClass(summary) {
        if (summary.failed > 0) {
          return 'failed';
        }
        if (summary.flaky > 0) {
          return 'flaky';
        }
        return 'passed';
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

      function cell(value) {
        return '<td>' + value + '</td>';
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

      function escapeAttr(value) {
        return String(value || '').replace(/[^a-z0-9_-]/gi, '');
      }
    </script>
  </body>
</html>
`;
}
