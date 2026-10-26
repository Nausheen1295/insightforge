/* ==========================================================================
   InsightForge — app wiring: loading, tabs, insights, charts, columns, data.
   ========================================================================== */
import { initTheme, esc } from "./theme.js";
import { profile, insights, suggestCharts, correlationMatrix, histogram, fmt } from "./profile.js";
import { buildChart, corrColor } from "./charts.js";

const $ = (id) => document.getElementById(id);
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_ROWS = 200000;
const SAMPLES = { penguins: "Palmer Penguins", stock_prices: "Stock prices 2007–2016", tips: "Restaurant tips" };
const TYPE_LABEL = { numeric: "Number", categorical: "Category", datetime: "Date", boolean: "Yes / no", text: "Text", identifier: "ID", empty: "Empty" };
const ICONS = {
  trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  correlation: '<circle cx="7" cy="16" r="2"/><circle cx="12" cy="11" r="2"/><circle cx="17" cy="6" r="2"/>',
  group: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  distribution: '<path d="M3 20h18M5 20c2-12 4-14 7-14s5 2 7 14"/>',
  outliers: '<circle cx="12" cy="12" r="3"/><circle cx="20" cy="4" r="1.5"/><path d="M3 12h3M18 12h3"/>',
  balance: '<path d="M12 3v18M5 7h14M5 7l-3 7h6zM19 7l-3 7h6z"/>',
  quality: '<path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
};
const KIND_LABEL = { trend: "Trend", correlation: "Relationship", group: "Group difference", distribution: "Distribution", outliers: "Outliers", balance: "Balance", quality: "Data quality" };

let state = null; // { name, columns, rows, p }
const charts = new Set();

/* ------------------------------------------------------------- loading */
function showError(msg) { const e = $("loadError"); e.textContent = msg; e.hidden = false; }

function parseText(text, name) {
  $("loadError").hidden = true;
  const trimmed = text.trim();
  if (!trimmed) return showError("That file is empty.");
  let columns, rows;
  if (/\.json$/i.test(name) || /^[[{]/.test(trimmed)) {
    let data;
    try { data = JSON.parse(trimmed); } catch { return showError("That JSON couldn't be read. Check it's valid JSON."); }
    if (!Array.isArray(data)) data = Object.values(data).find(Array.isArray) || [];
    if (!data.length || typeof data[0] !== "object") return showError("JSON needs to be an array of objects, like [{\"a\": 1}, …].");
    columns = [...new Set(data.slice(0, 1000).flatMap((o) => Object.keys(o)))];
    rows = data.map((o) => columns.map((c) => (o[c] == null ? "" : typeof o[c] === "object" ? JSON.stringify(o[c]) : String(o[c]))));
  } else {
    const res = Papa.parse(trimmed, { skipEmptyLines: "greedy", delimitersToGuess: [",", "\t", ";", "|"] });
    if (!res.data.length) return showError("No rows found in that file.");
    columns = res.data[0].map((c, i) => String(c).trim() || `column_${i + 1}`);
    // Make duplicate header names unique.
    const seen = new Map();
    columns = columns.map((c) => { const n = seen.get(c) || 0; seen.set(c, n + 1); return n ? `${c}_${n + 1}` : c; });
    rows = res.data.slice(1).map((r) => columns.map((_, i) => r[i] ?? ""));
  }
  if (!rows.length) return showError("The file has a header row but no data rows.");
  let truncated = false;
  if (rows.length > MAX_ROWS) { rows = rows.slice(0, MAX_ROWS); truncated = true; }
  analyse(name, columns, rows, truncated);
}

function loadFile(file) {
  if (!file) return;
  if (file.size > MAX_BYTES) return showError(`That file is ${(file.size / 1048576).toFixed(0)} MB — the limit is 50 MB.`);
  const reader = new FileReader();
  reader.onload = () => parseText(String(reader.result), file.name);
  reader.onerror = () => showError("The file couldn't be read.");
  reader.readAsText(file);
}

async function loadSample(id) {
  try {
    const res = await fetch(`samples/${id}.csv`);
    if (!res.ok) throw new Error(res.status);
    parseText(await res.text(), SAMPLES[id]);
    history.replaceState(null, "", `?sample=${id}`);
  } catch { showError("The sample couldn't be loaded. Check your connection and try again."); }
}

const drop = $("drop");
$("fileInput").addEventListener("change", (e) => loadFile(e.target.files[0]));
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("is-over")));
drop.addEventListener("drop", (e) => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });
document.querySelectorAll("[data-sample]").forEach((b) => b.addEventListener("click", () => loadSample(b.dataset.sample)));
$("pasteBtn").addEventListener("click", () => parseText($("pasteInput").value, "Pasted data"));
$("resetBtn").addEventListener("click", () => {
  destroyCharts();
  state = null;
  $("results").hidden = true; $("landing").hidden = false;
  $("fileInput").value = "";
  history.replaceState(null, "", location.pathname);
  scrollTo(0, 0);
});

/* ------------------------------------------------------------ analysis */
function analyse(name, columns, rows, truncated) {
  const p = profile(columns, rows);
  state = { name, columns, rows, p, insights: insights(p), suggestions: suggestCharts(p), truncated };
  $("landing").hidden = true;
  $("results").hidden = false;
  $("dsName").textContent = name.replace(/\.(csv|tsv|txt|json)$/i, "");
  const missing = p.columns.reduce((a, c) => a + c.missing, 0) / (p.rowCount * p.columns.length);
  const byType = (t) => p.columns.filter((c) => c.type === t).length;
  $("dsStats").innerHTML = [
    [p.rowCount.toLocaleString(), truncated ? `rows (first ${MAX_ROWS.toLocaleString()})` : "rows"],
    [p.columns.length, "columns"],
    [`${byType("numeric")} · ${byType("categorical") + byType("boolean")} · ${byType("datetime")}`, "number · category · date columns"],
    [`${(missing * 100).toFixed(1)}%`, "missing cells"],
    [p.duplicates.toLocaleString(), "duplicate rows"],
  ].map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join("");
  renderInsights();
  renderColumns();
  renderCorr();
  setupBuilder();
  dataFilter = ""; $("dataFilter").value = ""; sortBy = null;
  renderData();
  showTab($("t-insights"));
  chartsDrawn = false;
  scrollTo(0, 0);
}

/* ---------------------------------------------------------------- tabs */
const tabs = [...document.querySelectorAll('[role="tab"]')];
let chartsDrawn = false;
function showTab(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
  });
  // Charts need a visible canvas to size themselves, so draw on first open.
  if (tab.id === "t-charts" && !chartsDrawn && state) { chartsDrawn = true; renderSuggestions(); }
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => showTab(t));
  t.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    const n = tabs[(i + d + tabs.length) % tabs.length];
    showTab(n); n.focus();
  });
});

/* ------------------------------------------------------------ insights */
function renderInsights() {
  const list = state.insights;
  $("insightList").innerHTML = list.length
    ? list.map((it) => `
      <li class="card insight">
        <span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[it.kind]}</svg></span>
        <div><p class="text">${esc(it.text)}</p>${it.detail ? `<p class="detail">${esc(it.detail)}</p>` : ""}<span class="tag">${KIND_LABEL[it.kind]}</span></div>
      </li>`).join("")
    : '<li class="empty">Nothing stands out strongly — no strong trends, relationships, skew or quality issues. The Columns tab has the full profile.</li>';
}

/* -------------------------------------------------------------- charts */
function destroyCharts() { charts.forEach((c) => c.destroy()); charts.clear(); }

function mountChart(container, spec) {
  let built;
  try { built = buildChart(spec, state.p); }
  catch (err) { container.innerHTML = `<p class="note error">Couldn't draw this chart: ${esc(err.message)}</p>`; return; }
  const id = `tbl-${Math.random().toString(36).slice(2, 8)}`;
  container.innerHTML = `
    <div class="chart-box"><canvas role="img" aria-label="${esc(spec.title || "Chart")}"></canvas></div>
    <div class="chart-foot"><span class="small muted">${esc(built.note || "")}</span>
      <button class="btn" type="button" aria-expanded="false" aria-controls="${id}">Show table</button></div>
    <div class="mini-table" id="${id}" hidden>${tableHTML(built.table.head, built.table.rows)}</div>`;
  const chart = new Chart(container.querySelector("canvas"), built.config);
  chart.$spec = spec; chart.$container = container;
  charts.add(chart);
  const btn = container.querySelector(".chart-foot .btn");
  btn.addEventListener("click", () => {
    const t = $(id); t.hidden = !t.hidden;
    btn.setAttribute("aria-expanded", String(!t.hidden));
    btn.textContent = t.hidden ? "Show table" : "Hide table";
  });
}

function renderSuggestions() {
  const grid = $("chartGrid");
  if (!state.suggestions.length) { grid.innerHTML = '<p class="empty">No numeric or category columns to chart. Try the builder above.</p>'; return; }
  grid.innerHTML = state.suggestions.map((s, i) => `
    <article class="card chart-card"><h3>${esc(s.title)}</h3><p class="reason">${esc(s.reason)}</p><div data-chart="${i}"></div></article>`).join("");
  state.suggestions.forEach((s, i) => mountChart(grid.querySelector(`[data-chart="${i}"]`), s));
}

function redrawAll() {
  [...charts].forEach((c) => { const { $spec, $container } = c; c.destroy(); charts.delete(c); mountChart($container, $spec); });
}
initTheme($("themeToggle"), () => requestAnimationFrame(redrawAll));

/* ------------------------------------------------------------- builder */
function setupBuilder() {
  const cols = state.p.columns;
  const opt = (c) => `<option value="${esc(c.name)}">${esc(c.name)} (${TYPE_LABEL[c.type]})</option>`;
  const usable = cols.filter((c) => c.type !== "empty" && !(c.type === "text"));
  $("bX").innerHTML = usable.map(opt).join("");
  $("bY").innerHTML = '<option value="">— none (count rows) —</option>' + cols.filter((c) => c.type === "numeric").map(opt).join("");
  $("bColor").innerHTML = '<option value="">— none —</option>' + cols.filter((c) => (c.type === "categorical" || c.type === "boolean") && c.unique <= 30).map(opt).join("");
  $("builderOut").innerHTML = "";
  $("builderHint").textContent = "";
  const first = state.suggestions[0];
  if (first) {
    $("bType").value = first.type;
    $("bX").value = first.x;
    $("bY").value = first.y || first.ys?.[0] || "";
    if (first.agg) $("bAgg").value = first.agg;
  }
  syncBuilder();
}
function syncBuilder() {
  const t = $("bType").value;
  $("bAgg").disabled = t !== "bar";
  $("bColor").disabled = t !== "scatter";
  $("bY").disabled = t === "histogram";
}
$("bType").addEventListener("change", syncBuilder);
$("builder").addEventListener("submit", (e) => {
  e.preventDefault();
  const col = (n) => state.p.columns.find((c) => c.name === n);
  const type = $("bType").value, x = $("bX").value, y = $("bY").value;
  const X = col(x), Y = y ? col(y) : null;
  const hint = $("builderHint");
  hint.textContent = "";
  let spec;
  if (type === "histogram") {
    if (X.type !== "numeric") { hint.textContent = "A histogram needs a number column on the X axis."; return; }
    spec = { type, x, title: `Distribution of ${x}` };
  } else if (type === "scatter") {
    if (X.type !== "numeric" || !Y) { hint.textContent = "A scatter plot needs number columns on both axes."; return; }
    spec = { type, x, y, color: $("bColor").value || undefined, title: `${y} vs ${x}` };
  } else if (type === "line") {
    if (!(X.type === "datetime" || X.type === "numeric") || !Y) { hint.textContent = "A line chart needs a date or number column on X and a number column on Y."; return; }
    spec = { type, x, y, title: `${y} by ${x}` };
  } else {
    const agg = Y ? $("bAgg").value : "count";
    if (X.type === "numeric" && X.unique > 40) { hint.textContent = `${x} has ${X.unique} distinct values — try a histogram instead, or pick a category column.`; return; }
    spec = { type, x, y: Y ? y : undefined, agg, title: Y ? `${agg} of ${y} by ${x}` : `Rows by ${x}` };
  }
  [...charts].filter((c) => c.$container === $("builderOut")).forEach((c) => { c.destroy(); charts.delete(c); });
  mountChart($("builderOut"), spec);
});

/* ------------------------------------------------------------- columns */
function sparkHist(values) {
  const bins = histogram(values);
  const max = Math.max(...bins.map((b) => b.count), 1);
  const w = 100 / bins.length;
  return `<svg class="spark" viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">${bins.map((b, i) =>
    `<rect x="${i * w + 0.4}" width="${Math.max(w - 0.8, 0.4)}" y="${48 - (b.count / max) * 46}" height="${(b.count / max) * 46}" rx="0.6"/>`).join("")}</svg>`;
}
function renderColumns() {
  const n = state.p.rowCount;
  $("colGrid").innerHTML = state.p.columns.map((c) => {
    const head = `<div class="row"><h3>${esc(c.name)}</h3><span class="tag">${TYPE_LABEL[c.type]}</span></div>
      <div class="kv"><div><b>${(((n - c.missing) / n) * 100).toFixed(0)}%</b>filled</div><div><b>${c.unique.toLocaleString()}</b>distinct</div><div><b>${c.missing.toLocaleString()}</b>missing</div></div>`;
    if (c.type === "numeric") {
      const s = c.stats;
      return `<article class="card col-card">${head}${sparkHist(c.values)}
        <div class="kv"><div><b>${fmt(s.mean)}</b>mean</div><div><b>${fmt(s.median)}</b>median</div><div><b>${fmt(s.std)}</b>std dev</div>
        <div><b>${fmt(s.min)}</b>min</div><div><b>${fmt(s.max)}</b>max</div><div><b>${s.outliers}</b>outliers</div></div></article>`;
    }
    if (c.type === "datetime") {
      const d = (t) => new Date(t).toISOString().slice(0, 10);
      const days = Math.round((c.stats.max - c.stats.min) / 864e5);
      return `<article class="card col-card">${head}<div class="kv"><div><b>${d(c.stats.min)}</b>earliest</div><div><b>${d(c.stats.max)}</b>latest</div><div><b>${days.toLocaleString()}</b>days span</div></div></article>`;
    }
    const present = n - c.missing;
    const top = (c.top || []).slice(0, 6);
    return `<article class="card col-card">${head}${top.length ? `<ul class="topvals">${top.map(([v, k]) =>
      `<li><span class="lbl" style="--w:${((k / present) * 100).toFixed(1)}%" title="${esc(v)}">${esc(v)}</span><span class="n">${((k / present) * 100).toFixed(0)}%</span></li>`).join("")}</ul>` : ""}
      ${c.type === "identifier" ? '<p class="small muted">Looks like an identifier — unique per row, so it’s left out of charts.</p>' : ""}</article>`;
  }).join("");
}

/* -------------------------------------------------------- correlations */
function renderCorr() {
  const { names, matrix } = correlationMatrix(state.p);
  if (names.length < 2) { $("corr").innerHTML = '<p class="empty">Correlations need at least two numeric columns.</p>'; return; }
  const ink = (r) => (Math.abs(r ?? 0) >= 0.55 ? "#fff" : "var(--text)");
  $("corr").innerHTML = `<div class="corr-wrap"><table class="heat"><thead><tr><td></td>${names.map((n) => `<th scope="col">${esc(n)}</th>`).join("")}</tr></thead>
    <tbody>${names.map((rn, i) => `<tr><th scope="row">${esc(rn)}</th>${matrix[i].map((r, j) =>
      `<td style="background:${corrColor(r)};color:${ink(r)}" title="${esc(rn)} × ${esc(names[j])}: r = ${r == null ? "n/a" : r.toFixed(3)}">${r == null ? "–" : r.toFixed(2)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="corr-legend"><span>−1</span><span class="ramp">${[-0.95, -0.75, -0.55, -0.35, -0.15, 0, 0.15, 0.35, 0.55, 0.75, 0.95].map((r) => `<span style="background:${corrColor(r)}"></span>`).join("")}</span><span>+1</span></div>`;
}

/* ---------------------------------------------------------------- data */
let dataFilter = "";
let sortBy = null; // { i, dir }
const PAGE = 300;
function tableHTML(head, rows) {
  return `<table class="data"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function renderData() {
  const { columns, rows, p } = state;
  let idx = rows.map((_, i) => i);
  if (dataFilter) { const q = dataFilter.toLowerCase(); idx = idx.filter((i) => rows[i].some((v) => String(v).toLowerCase().includes(q))); }
  if (sortBy) {
    const vals = p.columns[sortBy.i].values;
    idx.sort((a, b) => {
      const x = vals[a], y = vals[b];
      if (x == null) return 1; if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sortBy.dir;
    });
  }
  $("dataCount").textContent = `${idx.length.toLocaleString()} row${idx.length === 1 ? "" : "s"}${idx.length > PAGE ? ` · showing first ${PAGE}` : ""}`;
  const isNum = p.columns.map((c) => c.type === "numeric");
  $("dataTable").innerHTML = `<table class="data"><thead><tr>${columns.map((c, i) => {
    const s = sortBy?.i === i ? (sortBy.dir > 0 ? "ascending" : "descending") : "none";
    return `<th scope="col" aria-sort="${s}"><button type="button" data-sort="${i}">${esc(c)} ${s === "ascending" ? "▲" : s === "descending" ? "▼" : ""}</button></th>`;
  }).join("")}</tr></thead><tbody>${idx.slice(0, PAGE).map((i) => `<tr>${rows[i].map((v, j) =>
    p.columns[j].values[i] == null ? '<td class="miss">missing</td>' : `<td${isNum[j] ? ' class="num"' : ""}>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
$("dataTable").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sort]");
  if (!b) return;
  const i = Number(b.dataset.sort);
  sortBy = sortBy?.i === i ? (sortBy.dir > 0 ? { i, dir: -1 } : null) : { i, dir: 1 };
  renderData();
  $("dataTable").querySelector(`[data-sort="${i}"]`)?.focus();
});
let filterTimer;
$("dataFilter").addEventListener("input", (e) => { clearTimeout(filterTimer); filterTimer = setTimeout(() => { dataFilter = e.target.value.trim(); renderData(); }, 150); });

/* -------------------------------------------------------------- report */
$("reportBtn").addEventListener("click", () => {
  const { p, name } = state;
  const lines = [`# InsightForge report — ${name}`, "", `${p.rowCount.toLocaleString()} rows × ${p.columns.length} columns · generated ${new Date().toISOString().slice(0, 10)}`, "", "## Key findings", ""];
  state.insights.forEach((it) => lines.push(`- **${it.text}** ${it.detail}`));
  if (!state.insights.length) lines.push("- Nothing stood out strongly.");
  lines.push("", "## Columns", "", "| Column | Type | Missing | Distinct | Summary |", "|---|---|---|---|---|");
  for (const c of p.columns) {
    const sum = c.type === "numeric" ? `mean ${fmt(c.stats.mean)}, median ${fmt(c.stats.median)}, range ${fmt(c.stats.min)}–${fmt(c.stats.max)}`
      : c.type === "datetime" ? `${new Date(c.stats.min).toISOString().slice(0, 10)} → ${new Date(c.stats.max).toISOString().slice(0, 10)}`
      : (c.top || []).slice(0, 3).map(([v, k]) => `${v} (${k})`).join(", ");
    lines.push(`| ${c.name} | ${TYPE_LABEL[c.type]} | ${c.missing} | ${c.unique} | ${sum.replace(/\|/g, "\\|")} |`);
  }
  lines.push("", "_Generated by InsightForge (https://nausheen1295.github.io/insightforge/). Findings are statistical, not causal._");
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${name.replace(/[^\w-]+/g, "_")}-insights.md` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* --------------------------------------------------------------- start */
const sample = new URLSearchParams(location.search).get("sample");
if (sample && SAMPLES[sample]) loadSample(sample);
