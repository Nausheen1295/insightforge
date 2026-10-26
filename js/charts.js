/* ==========================================================================
   InsightForge — chart rendering (Chart.js). Colours come from CSS tokens so
   light and dark each use their own validated steps.
   ========================================================================== */
import { aggregate, histogram, fmt } from "./profile.js";

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const series = () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css(`--series-${i}`));
const MAX_POINTS = 2500;
const fmtDate = (t) => new Date(t).toISOString().slice(0, 10);

function baseOptions({ legend = false, xTitle, yTitle, xTime = false } = {}) {
  const ink = css("--text-soft"), mute = css("--chart-muted"), grid = css("--chart-grid");
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: "nearest", intersect: false },
    plugins: {
      legend: { display: legend, position: "top", align: "start", labels: { color: ink, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "rectRounded" } },
      tooltip: {
        backgroundColor: css("--surface"), titleColor: css("--text"), bodyColor: css("--text-soft"),
        borderColor: css("--line-strong"), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
        callbacks: xTime ? { title: (items) => fmtDate(items[0].parsed.x) } : {},
      },
    },
    scales: {
      x: {
        type: xTime ? "linear" : "category",
        grid: { display: false }, border: { color: css("--chart-axis") },
        ticks: { color: mute, maxRotation: 0, autoSkip: true, autoSkipPadding: 14, ...(xTime ? { callback: (v) => fmtDate(v).slice(0, 7) } : {}) },
        title: xTitle ? { display: true, text: xTitle, color: mute } : undefined,
      },
      y: {
        grid: { color: grid }, border: { display: false },
        ticks: { color: mute, callback: (v) => fmt(v) },
        title: yTitle ? { display: true, text: yTitle, color: mute } : undefined,
      },
    },
  };
}

/** Evenly thins a long series so the chart stays responsive. */
function thin(points, max = MAX_POINTS) {
  if (points.length <= max) return points;
  const step = points.length / max;
  return Array.from({ length: max }, (_, i) => points[Math.floor(i * step)]);
}

/**
 * Builds a Chart.js config for a spec: {type, x, y?, ys?, agg?, color?, index?}.
 * Returns { config, table } — `table` is the same data as rows, for the table view.
 */
export function buildChart(spec, p) {
  const col = (n) => p.columns.find((c) => c.name === n);
  const pal = series();
  const surface = css("--surface");
  const X = col(spec.x);

  if (spec.type === "histogram") {
    const bins = histogram(X.values);
    return {
      config: {
        type: "bar",
        data: { labels: bins.map((b) => `${fmt(b.from)}–${fmt(b.to)}`), datasets: [{ label: "Rows", data: bins.map((b) => b.count), backgroundColor: pal[0], borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", categoryPercentage: 1, barPercentage: 0.94 }] },
        options: baseOptions({ xTitle: spec.x, yTitle: "Rows" }),
      },
      table: { head: [spec.x, "Rows"], rows: bins.map((b) => [`${fmt(b.from)} – ${fmt(b.to)}`, b.count]) },
    };
  }

  if (spec.type === "bar") {
    const Y = spec.y ? col(spec.y) : null;
    let rows = aggregate(X, Y, spec.agg || "count");
    let folded = 0;
    if (rows.length > 15 && X.type !== "numeric") { folded = rows.length - 15; rows = rows.slice(0, 15); }
    const label = Y ? `${spec.agg} of ${spec.y}` : "Rows";
    const opts = baseOptions({ xTitle: spec.x, yTitle: label });
    return {
      config: {
        type: "bar",
        data: { labels: rows.map((r) => String(r.key)), datasets: [{ label, data: rows.map((r) => r.value), backgroundColor: pal[0], borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 48 }] },
        options: opts,
      },
      table: { head: [spec.x, label], rows: rows.map((r) => [r.key, fmt(r.value)]) },
      note: folded ? `Showing the top 15 of ${rows.length + folded} groups.` : "",
    };
  }

  if (spec.type === "line") {
    const ys = spec.ys || [spec.y];
    const isTime = X.type === "datetime";
    const order = X.values.map((v, i) => i).filter((i) => X.values[i] != null).sort((a, b) => X.values[a] - X.values[b]);
    const datasets = ys.map((name, k) => {
      const Y = col(name);
      let pts = order.filter((i) => Y.values[i] != null).map((i) => ({ x: X.values[i], y: Y.values[i] }));
      if (spec.index && pts.length) { const base = pts[0].y || 1; pts = pts.map((pt) => ({ x: pt.x, y: (pt.y / base) * 100 })); }
      return { label: name, data: thin(pts), borderColor: pal[k], backgroundColor: pal[k], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHoverBorderColor: surface, pointHoverBorderWidth: 2, tension: 0 };
    });
    const opts = baseOptions({ legend: ys.length > 1, xTime: isTime || X.type === "numeric", yTitle: spec.index ? "Index (start = 100)" : ys[0] });
    if (!isTime) opts.scales.x.ticks.callback = (v) => fmt(v);
    opts.interaction = { mode: "index", intersect: false, axis: "x" };
    const first = datasets[0].data;
    if (first.length) { opts.scales.x.min = first[0].x; opts.scales.x.max = first.at(-1).x; }
    return {
      config: { type: "line", data: { datasets }, options: opts, plugins: [crosshair] },
      table: { head: [spec.x, ...ys.map((n) => (spec.index ? `${n} (index)` : n))], rows: first.slice(0, 500).map((pt, i) => [isTime ? fmtDate(pt.x) : fmt(pt.x), ...datasets.map((d) => fmt(d.data[i]?.y))]) },
      note: first.length < order.length ? `Thinned to ${first.length.toLocaleString()} points for speed.` : "",
    };
  }

  if (spec.type === "scatter") {
    const Y = col(spec.y);
    const C = spec.color ? col(spec.color) : null;
    const idx = X.values.map((_, i) => i).filter((i) => X.values[i] != null && Y.values[i] != null);
    // Scatter colour-by is capped at three groups (all-pairs CVD safe); the rest fold into "Other".
    let groups = [["All rows", idx]];
    if (C) {
      const byKey = new Map();
      for (const i of idx) { const k = C.values[i] ?? "Missing"; (byKey.get(k) || byKey.set(k, []).get(k)).push(i); }
      const sorted = [...byKey].sort((a, b) => b[1].length - a[1].length);
      groups = sorted.slice(0, 3);
      const rest = sorted.slice(3).flatMap(([, v]) => v);
      if (rest.length) groups.push(["Other", rest]);
    }
    const datasets = groups.map(([key, ids], k) => ({
      label: String(key),
      data: thin(ids.map((i) => ({ x: X.values[i], y: Y.values[i] })), 3000),
      backgroundColor: key === "Other" ? css("--chart-muted") : pal[k],
      borderColor: surface, borderWidth: 1, pointRadius: 4, pointHoverRadius: 6,
    }));
    const opts = baseOptions({ legend: datasets.length > 1, xTitle: spec.x, yTitle: spec.y });
    opts.scales.x.type = "linear";
    opts.scales.x.ticks.callback = (v) => fmt(v);
    opts.scales.x.grid = { color: css("--chart-grid") };
    opts.interaction = { mode: "nearest", intersect: true };
    opts.plugins.tooltip.callbacks = { label: (c) => `${c.dataset.label}: ${spec.x} ${fmt(c.parsed.x)}, ${spec.y} ${fmt(c.parsed.y)}` };
    return {
      config: { type: "scatter", data: { datasets }, options: opts },
      table: { head: [spec.x, spec.y, ...(C ? [spec.color] : [])], rows: idx.slice(0, 500).map((i) => [fmt(X.values[i]), fmt(Y.values[i]), ...(C ? [C.values[i] ?? "—"] : [])]) },
    };
  }
  throw new Error(`Unknown chart type ${spec.type}`);
}

/** Vertical crosshair on line charts. */
const crosshair = {
  id: "crosshair",
  afterDatasetsDraw(chart) {
    const a = chart.tooltip?.getActiveElements?.();
    if (!a?.length) return;
    const { ctx, chartArea: { top, bottom } } = chart;
    ctx.save();
    ctx.strokeStyle = css("--chart-axis");
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a[0].element.x, top); ctx.lineTo(a[0].element.x, bottom); ctx.stroke();
    ctx.restore();
  },
};

/** Diverging colour for a correlation: blue (−1) ↔ grey (0) ↔ red (+1). */
export function corrColor(r) {
  if (r == null) return "transparent";
  const NEG = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];
  const POS = ["#fbd5cf", "#f6ad9f", "#ef8571", "#e66767", "#d03b3b", "#a52a2a"];
  const a = Math.min(1, Math.abs(r));
  if (a < 0.1) return css("--chart-neutral");
  const ramp = r < 0 ? NEG : POS;
  return ramp[Math.min(ramp.length - 1, Math.floor(((a - 0.1) / 0.9) * ramp.length))];
}
