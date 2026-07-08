#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const distDir = path.join(repoRoot, 'dist');
const dataDir = path.join(repoRoot, 'data');
const distDataDir = path.join(distDir, 'data');

const csvFiles = ['routes.csv', 'runs.csv', 'route_results.csv', 'route_stats.csv'];

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
        --bg: #f6f7f9;
        --panel: #ffffff;
        --panel-border: #d9dee7;
        --text: #172033;
        --muted: #5e6a7d;
        --accent: #0f766e;
        --danger: #b42318;
        --warn: #b54708;
        --ok: #16703c;
        --shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
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
        line-height: 1.5;
      }

      a {
        color: var(--accent);
      }

      .shell {
        width: min(1440px, calc(100% - 32px));
        margin: 0 auto;
        padding: 28px 0 40px;
      }

      header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 20px;
      }

      h1 {
        margin: 0 0 6px;
        font-size: clamp(28px, 4vw, 42px);
        line-height: 1.05;
        letter-spacing: 0;
      }

      .subtitle {
        margin: 0;
        color: var(--muted);
        max-width: 760px;
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
        border: 1px solid var(--panel-border);
        border-radius: 6px;
        background: var(--panel);
        color: var(--text);
        text-decoration: none;
        font-weight: 600;
        white-space: nowrap;
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(6, minmax(140px, 1fr));
        gap: 10px;
        margin-bottom: 16px;
      }

      .metric,
      .panel {
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 8px;
        box-shadow: var(--shadow);
      }

      .metric {
        padding: 14px;
        min-height: 92px;
      }

      .metric-label {
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
      }

      .metric-value {
        margin-top: 6px;
        font-size: 28px;
        font-weight: 800;
        line-height: 1.1;
      }

      .metric-note {
        margin-top: 3px;
        color: var(--muted);
        font-size: 12px;
      }

      .panel {
        padding: 16px;
        margin-top: 16px;
      }

      .panel-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 12px;
      }

      h2 {
        margin: 0;
        font-size: 18px;
        letter-spacing: 0;
      }

      .controls {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) auto auto;
        gap: 10px;
        margin-bottom: 12px;
      }

      input,
      select {
        width: 100%;
        min-height: 38px;
        border: 1px solid var(--panel-border);
        border-radius: 6px;
        background: #ffffff;
        color: var(--text);
        padding: 0 10px;
        font: inherit;
      }

      .table-wrap {
        overflow: auto;
        border: 1px solid var(--panel-border);
        border-radius: 8px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 1060px;
        background: #ffffff;
      }

      th,
      td {
        padding: 9px 10px;
        border-bottom: 1px solid #e8ecf2;
        text-align: left;
        vertical-align: top;
        font-size: 13px;
      }

      th {
        position: sticky;
        top: 0;
        z-index: 1;
        background: #f2f5f8;
        color: #394559;
        font-size: 12px;
        text-transform: uppercase;
      }

      tbody tr:hover {
        background: #f9fbfc;
      }

      .route {
        min-width: 420px;
        max-width: 640px;
        word-break: break-word;
      }

      .muted {
        color: var(--muted);
      }

      .tag-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .tag {
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        padding: 0 7px;
        border-radius: 999px;
        background: #e7f3f1;
        color: #0f5e57;
        font-size: 12px;
        font-weight: 700;
      }

      .status {
        font-weight: 800;
      }

      .status.failed {
        color: var(--danger);
      }

      .status.flaky {
        color: var(--warn);
      }

      .status.passed,
      .status.success {
        color: var(--ok);
      }

      .empty {
        padding: 26px;
        color: var(--muted);
        text-align: center;
      }

      @media (max-width: 980px) {
        header,
        .panel-heading {
          flex-direction: column;
          align-items: stretch;
        }

        .actions {
          justify-content: flex-start;
        }

        .summary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .controls {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 560px) {
        .shell {
          width: min(100% - 20px, 1440px);
          padding-top: 18px;
        }

        .summary {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header>
        <div>
          <h1>AoE Desktop E2E CI Metrics</h1>
          <p class="subtitle">Route-level Playwright E2E outcomes from AoE Desktop GitHub CI. Route IDs are stable spec/title paths rather than execution order.</p>
        </div>
        <nav class="actions" aria-label="CSV downloads">
          <a class="button" href="data/routes.csv">routes.csv</a>
          <a class="button" href="data/runs.csv">runs.csv</a>
          <a class="button" href="data/route_results.csv">route_results.csv</a>
          <a class="button" href="data/route_stats.csv">route_stats.csv</a>
        </nav>
      </header>

      <section class="summary" aria-label="Summary metrics">
        <div class="metric"><div class="metric-label">Runs</div><div id="metric-runs" class="metric-value">...</div><div class="metric-note">CI runs imported</div></div>
        <div class="metric"><div class="metric-label">Routes</div><div id="metric-routes" class="metric-value">...</div><div class="metric-note">Stable E2E routes</div></div>
        <div class="metric"><div class="metric-label">Failing Routes</div><div id="metric-failing" class="metric-value">...</div><div class="metric-note">At least one final failure</div></div>
        <div class="metric"><div class="metric-label">Flaky Routes</div><div id="metric-flaky" class="metric-value">...</div><div class="metric-note">Retry recovered</div></div>
        <div class="metric"><div class="metric-label">Avg Pass Rate</div><div id="metric-pass-rate" class="metric-value">...</div><div class="metric-note">Across observed routes</div></div>
        <div class="metric"><div class="metric-label">Last Run</div><div id="metric-last-run" class="metric-value">...</div><div id="metric-last-run-note" class="metric-note">Loading</div></div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <h2>Route Statistics</h2>
          <span id="route-count" class="muted">Loading</span>
        </div>
        <div class="controls">
          <input id="search" type="search" placeholder="Search route, module tag, or error signature" aria-label="Search routes">
          <select id="filter" aria-label="Filter routes">
            <option value="all">All routes</option>
            <option value="failed">Final failures</option>
            <option value="flaky">Flaky routes</option>
            <option value="attempts">Attempt failures</option>
          </select>
          <select id="sort" aria-label="Sort routes">
            <option value="risk">Sort by risk</option>
            <option value="failed">Sort by failed runs</option>
            <option value="flaky">Sort by flaky runs</option>
            <option value="passRate">Sort by pass rate</option>
            <option value="route">Sort by route</option>
          </select>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Route</th>
                <th>Tags</th>
                <th>Total</th>
                <th>Failed</th>
                <th>Flaky</th>
                <th>Attempts</th>
                <th>Pass Rate</th>
                <th>macOS</th>
                <th>Windows</th>
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
          <span id="generated-at" class="muted">Loading</span>
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
      };

      const state = {
        runs: [],
        stats: [],
      };

      Promise.all([
        fetchJson(files.manifest),
        fetchCsv(files.runs),
        fetchCsv(files.stats),
      ])
        .then(([manifest, runs, stats]) => {
          state.runs = runs;
          state.stats = stats;
          renderSummary(manifest);
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
        const failingRoutes = state.stats.filter((row) => number(row.failed_runs) > 0).length;
        const flakyRoutes = state.stats.filter((row) => number(row.flaky_runs) > 0).length;
        const avgPassRate = totalRoutes
          ? state.stats.reduce((sum, row) => sum + number(row.pass_rate), 0) / totalRoutes
          : 0;
        const lastRun = [...state.runs].sort((left, right) =>
          String(right.completed_at).localeCompare(String(left.completed_at)),
        )[0];

        setText('metric-runs', state.runs.length);
        setText('metric-routes', totalRoutes);
        setText('metric-failing', failingRoutes);
        setText('metric-flaky', flakyRoutes);
        setText('metric-pass-rate', formatPercent(avgPassRate));
        setText('metric-last-run', lastRun?.conclusion || 'n/a');
        document.getElementById('metric-last-run').className = 'metric-value status ' + (lastRun?.conclusion || '');
        setText('metric-last-run-note', lastRun ? '#' + lastRun.run_number + ' on ' + lastRun.branch : 'No runs');
        setText('generated-at', 'Generated ' + formatDateTime(manifest.generated_at));
      }

      function renderRuns() {
        const body = document.getElementById('runs-body');
        const rows = [...state.runs].sort((left, right) =>
          String(right.completed_at).localeCompare(String(left.completed_at)),
        );

        body.innerHTML = rows
          .map(
            (run) => '<tr>' +
              cell('#' + escapeHtml(run.run_number || run.run_id)) +
              cell(escapeHtml(run.run_attempt)) +
              cell(escapeHtml(run.workflow)) +
              cell(escapeHtml(run.branch)) +
              cell(escapeHtml(run.event)) +
              cell(formatDateTime(run.started_at)) +
              cell(formatDateTime(run.completed_at)) +
              cell('<span class="status ' + escapeAttr(run.conclusion) + '">' + escapeHtml(run.conclusion) + '</span>') +
              '</tr>',
          )
          .join('');
      }

      function bindControls() {
        for (const id of ['search', 'filter', 'sort']) {
          document.getElementById(id).addEventListener('input', renderRoutes);
        }
      }

      function renderRoutes() {
        const search = document.getElementById('search').value.trim().toLowerCase();
        const filter = document.getElementById('filter').value;
        const sort = document.getElementById('sort').value;
        const body = document.getElementById('routes-body');

        let rows = state.stats.filter((row) => {
          const haystack = [row.route_id, row.module_tags, row.top_error_signature].join(' ').toLowerCase();
          if (search && !haystack.includes(search)) {
            return false;
          }
          if (filter === 'failed') {
            return number(row.failed_runs) > 0;
          }
          if (filter === 'flaky') {
            return number(row.flaky_runs) > 0;
          }
          if (filter === 'attempts') {
            return number(row.attempt_failures) > 0;
          }
          return true;
        });

        rows = rows.sort(compareRoutes(sort)).slice(0, 500);
        setText('route-count', rows.length + ' shown of ' + state.stats.length);

        if (rows.length === 0) {
          body.innerHTML = '<tr><td class="empty" colspan="11">No matching routes.</td></tr>';
          return;
        }

        body.innerHTML = rows.map(renderRouteRow).join('');
      }

      function renderRouteRow(row) {
        return '<tr>' +
          cell('<div class="route">' + escapeHtml(row.route_id) + '</div>') +
          cell(renderTags(row.module_tags)) +
          cell(number(row.total_runs)) +
          cell(number(row.failed_runs)) +
          cell(number(row.flaky_runs)) +
          cell(number(row.attempt_failures)) +
          cell(formatPercent(number(row.pass_rate))) +
          cell(number(row.failed_runs_macos)) +
          cell(number(row.failed_runs_windows)) +
          cell('<span class="status ' + escapeAttr(row.last_outcome) + '">' + escapeHtml(row.last_outcome) + '</span>') +
          cell(escapeHtml(row.top_error_signature || row.last_failed_at || '')) +
          '</tr>';
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

      function renderTags(value) {
        const tags = String(value || '').split(';').filter(Boolean);
        if (tags.length === 0) {
          return '<span class="muted">none</span>';
        }
        return '<div class="tag-list">' + tags.map((tag) => '<span class="tag">' + escapeHtml(tag) + '</span>').join('') + '</div>';
      }

      function routeCompare(left, right) {
        return String(left.route_id).localeCompare(String(right.route_id));
      }

      function number(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      }

      function formatPercent(value) {
        return (value * 100).toFixed(1) + '%';
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
