/* ==========================================================================
   InsightForge — analysis engine. Pure functions, no DOM (tested in tests/).
   Input: rows as arrays of raw strings, plus column names.
   ========================================================================== */

const MISSING = new Set(["", "na", "n/a", "nan", "null", "none", "-", "?"]);
export const isMissing = (v) => v == null || MISSING.has(String(v).trim().toLowerCase());

const NUM_RE = /^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][-+]?\d+)?%?$/;
export function toNumber(v) {
  const s = String(v).trim().replace(/^[$€£₹]/, "");
  if (!s || !NUM_RE.test(s) || s === "." || s === "%") return null;
  const n = Number(s.replace(/,/g, "").replace(/%$/, ""));
  return Number.isFinite(n) ? n : null;
}

// Dates: ISO (2024-03-01, 2024-03-01T10:00), 2024/03/01, 01/03/2024, "Mar 2024", "1 March 2024".
const DATE_RE = [
  /^\d{4}-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
  /^\d{4}\/\d{1,2}\/\d{1,2}$/,
  /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/,
  /^\d{4}-\d{2}$/,
  /^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}$/,
  /^\d{1,2} [A-Za-z]{3,9}\.? \d{4}$/,
  /^[A-Za-z]{3,9} \d{4}$/,
];
export function toDate(v) {
  const s = String(v).trim();
  if (!DATE_RE.some((r) => r.test(s))) return null;
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    // Day-first unless that's impossible (e.g. 03/25/2024).
    let [, a, b, y] = m.map(Number);
    if (a <= 12 && b > 12) [a, b] = [b, a];
    const d = new Date(Date.UTC(y, b - 1, a));
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  m = s.match(/^(\d{4})-(\d{2})$/);
  const iso = m ? `${s}-01` : s;
  const t = Date.parse(/^\d{4}-\d{1,2}-\d{1,2}$/.test(iso) ? `${iso}T00:00:00Z` : iso.replace(/\//g, "-").replace(/^(\d{4}-\d{1,2}-\d{1,2})$/, "$1T00:00:00Z"));
  return Number.isNaN(t) ? null : t;
}

const BOOL = new Set(["true", "false", "yes", "no", "y", "n", "t", "f"]);

/** Infers a column's type from its non-missing values. */
export function inferType(values, name = "") {
  const present = values.filter((v) => !isMissing(v));
  if (!present.length) return "empty";
  const uniq = new Set(present);
  const share = (fn) => present.filter((v) => fn(v) != null).length / present.length;
  if (uniq.size <= 2 && [...uniq].every((v) => BOOL.has(String(v).trim().toLowerCase()))) return "boolean";
  if (share(toNumber) >= 0.98) {
    // Integer columns that look like years or ids aren't measurements.
    const nums = present.map(toNumber).filter((n) => n != null);
    const ints = nums.every(Number.isInteger);
    if (ints && /(^|_|\s)(id|code|zip|pin|phone)s?$/i.test(name) ) return "identifier";
    if (ints && /year/i.test(name) && nums.every((n) => n >= 1800 && n <= 2200)) return "categorical";
    return "numeric";
  }
  if (share(toDate) >= 0.95) return "datetime";
  const ratio = uniq.size / present.length;
  if (uniq.size <= Math.max(25, Math.min(60, present.length * 0.05))) return "categorical";
  if (ratio > 0.9) return present.some((v) => String(v).length > 40) ? "text" : "identifier";
  return "text";
}

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function numericStats(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const std = Math.sqrt(variance);
  const q1 = quantile(s, 0.25), median = quantile(s, 0.5), q3 = quantile(s, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  const skew = n > 2 && std > 0 ? (s.reduce((a, b) => a + ((b - mean) / std) ** 3, 0) * n) / ((n - 1) * (n - 2)) : 0;
  return {
    count: n, mean, std, min: s[0], q1, median, q3, max: s[n - 1], skew,
    outliers: iqr > 0 ? s.filter((v) => v < lo || v > hi).length : 0,
    zeros: s.filter((v) => v === 0).length,
    sum: s.reduce((a, b) => a + b, 0),
  };
}

function counts(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

/**
 * Profiles a dataset. Returns { rows, columns: [{name, type, missing, unique, stats|top, values}] }.
 * `values` holds parsed values (number | timestamp | string | null) for charting.
 */
export function profile(columns, rows) {
  const cols = columns.map((name, ci) => {
    const raw = rows.map((r) => r[ci]);
    const type = inferType(raw, name);
    const missing = raw.filter(isMissing).length;
    const parse = type === "numeric" ? toNumber : type === "datetime" ? toDate
      : (v) => String(v).trim();
    const values = raw.map((v) => (isMissing(v) ? null : parse(v)));
    const present = values.filter((v) => v != null);
    const col = { name, type, missing, unique: new Set(present).size, values };
    if (type === "numeric") col.stats = numericStats(present);
    else if (type === "datetime") {
      const s = [...present].sort((a, b) => a - b);
      col.stats = { min: s[0], max: s[s.length - 1] };
    } else col.top = counts(present).slice(0, 12);
    return col;
  });
  const keys = rows.map((r) => r.join("\u0001"));
  const duplicates = keys.length - new Set(keys).size;
  return { rowCount: rows.length, columns: cols, duplicates };
}

/** Pearson correlation over rows where both values exist. */
export function pearson(a, b) {
  let n = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) if (a[i] != null && b[i] != null) { n++; sa += a[i]; sb += b[i]; }
  if (n < 3) return null;
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] == null || b[i] == null) continue;
    num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

export function correlationMatrix(p) {
  const nums = p.columns.filter((c) => c.type === "numeric" && c.stats.std > 0).slice(0, 12);
  const matrix = nums.map((a) => nums.map((b) => (a === b ? 1 : pearson(a.values, b.values))));
  return { names: nums.map((c) => c.name), matrix };
}

/** Effect size of a category on a number: eta² (share of variance explained by groups). */
export function groupEffect(catCol, numCol) {
  const groups = new Map();
  catCol.values.forEach((c, i) => {
    const v = numCol.values[i];
    if (c == null || v == null) return;
    const g = groups.get(c) || { sum: 0, n: 0 };
    g.sum += v; g.n += 1;
    groups.set(c, g);
  });
  const list = [...groups].map(([k, g]) => ({ key: k, mean: g.sum / g.n, n: g.n })).filter((g) => g.n >= 3);
  if (list.length < 2) return null;
  const all = numCol.values.filter((v, i) => v != null && catCol.values[i] != null);
  const grand = all.reduce((a, b) => a + b, 0) / all.length;
  const total = all.reduce((a, v) => a + (v - grand) ** 2, 0);
  const between = list.reduce((a, g) => a + g.n * (g.mean - grand) ** 2, 0);
  list.sort((a, b) => b.mean - a.mean);
  return { eta2: total ? between / total : 0, groups: list };
}

export const fmt = (v) => {
  if (v == null || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return Math.round(v).toLocaleString("en-US");
  if (a >= 100) return v.toFixed(1).replace(/\.0$/, "");
  if (a >= 1) return v.toFixed(2).replace(/\.?0+$/, "");
  return v.toPrecision(3).replace(/\.?0+$/, "");
};
const pct = (v) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
const fmtDate = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * Plain-language findings, strongest first. Each insight cites the numbers it
 * is based on — no guessing, no causal claims.
 */
export function insights(p) {
  const out = [];
  const add = (kind, score, text, detail = "") => out.push({ kind, score, text, detail });
  const nums = p.columns.filter((c) => c.type === "numeric" && c.stats.std > 0);
  const cats = p.columns.filter((c) => (c.type === "categorical" || c.type === "boolean") && c.unique >= 2 && c.unique <= 30);
  const dates = p.columns.filter((c) => c.type === "datetime");
  const cells = p.rowCount * p.columns.length;
  const missingCells = p.columns.reduce((a, c) => a + c.missing, 0);

  // Trends over time.
  for (const d of dates.slice(0, 1)) {
    for (const n of nums.slice(0, 6)) {
      const pts = d.values.map((t, i) => [t, n.values[i]]).filter(([t, v]) => t != null && v != null).sort((a, b) => a[0] - b[0]);
      if (pts.length < 10) continue;
      const k = Math.max(1, Math.round(pts.length * 0.05));
      const avg = (arr) => arr.reduce((s, [, v]) => s + v, 0) / arr.length;
      const start = avg(pts.slice(0, k)), end = avg(pts.slice(-k));
      const peak = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
      const change = start !== 0 ? (end - start) / Math.abs(start) : null;
      if (change == null) continue;
      const dir = change > 0.02 ? "rose" : change < -0.02 ? "fell" : "stayed roughly flat";
      add("trend", 0.3 + 0.9 * Math.min(1, Math.log10(1 + Math.abs(change))),
        `${n.name} ${dir}${dir === "stayed roughly flat" ? "" : ` ${pct(Math.abs(change))}`} between ${fmtDate(pts[0][0])} and ${fmtDate(pts.at(-1)[0])}.`,
        `Start average ${fmt(start)} → end average ${fmt(end)} (first and last ${k} points). Peak ${fmt(peak[1])} on ${fmtDate(peak[0])}.`);
    }
  }

  // Strong correlations.
  const pairs = [];
  for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) {
    const r = pearson(nums[i].values, nums[j].values);
    if (r != null) pairs.push({ a: nums[i], b: nums[j], r });
  }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  for (const { a, b, r } of pairs.slice(0, 3)) {
    if (Math.abs(r) < 0.5) break;
    const strength = Math.abs(r) >= 0.8 ? "strongly" : "moderately";
    add("correlation", Math.abs(r),
      `${a.name} and ${b.name} are ${strength} ${r > 0 ? "positively" : "negatively"} correlated (r = ${r.toFixed(2)}).`,
      `When ${a.name} is higher, ${b.name} tends to be ${r > 0 ? "higher" : "lower"}. ` +
        (dates.length ? "Both are measured over time, and series that share a trend often correlate without being linked." : "Correlation alone doesn't show that one causes the other."));
  }

  // Group differences.
  const effects = [];
  for (const c of cats) for (const n of nums) {
    const e = groupEffect(c, n);
    if (e && e.eta2 >= 0.14) effects.push({ c, n, e });
  }
  effects.sort((x, y) => y.e.eta2 - x.e.eta2);
  for (const { c, n, e } of effects.slice(0, 3)) {
    const hi = e.groups[0], lo = e.groups[e.groups.length - 1];
    const diff = lo.mean !== 0 ? (hi.mean - lo.mean) / Math.abs(lo.mean) : null;
    add("group", e.eta2 * 0.95,
      `${c.name} explains ${pct(e.eta2)} of the variation in ${n.name}.`,
      `Average ${n.name}: ${hi.key} ${fmt(hi.mean)} vs ${lo.key} ${fmt(lo.mean)}${diff != null ? ` (${diff >= 0 ? "+" : ""}${pct(diff)})` : ""}.`);
  }

  // Distributions.
  for (const n of nums) {
    const s = n.stats;
    if (Math.abs(s.skew) >= 1)
      add("distribution", Math.min(0.7, Math.abs(s.skew) / 4 + 0.25),
        `${n.name} is ${s.skew > 0 ? "right" : "left"}-skewed: the median (${fmt(s.median)}) is ${s.skew > 0 ? "below" : "above"} the mean (${fmt(s.mean)}).`,
        `${s.skew > 0 ? "A few large values pull the average up" : "A few small values pull the average down"}, so the median is the better "typical" value. Skewness ${s.skew.toFixed(2)}.`);
    if (s.outliers / s.count >= 0.01 && s.outliers >= 2)
      add("outliers", Math.min(0.6, (s.outliers / s.count) * 4 + 0.2),
        `${n.name} has ${s.outliers} outlier${s.outliers === 1 ? "" : "s"} (${pct(s.outliers / s.count)} of values).`,
        `Outside 1.5 × IQR of the middle half (${fmt(s.q1)} – ${fmt(s.q3)}). Range ${fmt(s.min)} – ${fmt(s.max)}.`);
  }

  // Category balance.
  for (const c of cats) {
    const [top, n] = c.top[0];
    const share = n / (p.rowCount - c.missing);
    if (share >= 0.6 && c.unique > 1)
      add("balance", share * 0.5, `${c.name} is dominated by “${top}” (${pct(share)} of rows).`,
        `${c.unique} distinct values. Comparisons across the smaller groups rest on fewer rows.`);
  }

  // Data quality.
  if (missingCells / cells >= 0.01) {
    const worst = [...p.columns].sort((a, b) => b.missing - a.missing)[0];
    add("quality", 0.55, `${pct(missingCells / cells)} of cells are empty; ${worst.name} has the most gaps (${worst.missing} missing).`,
      "Statistics above ignore missing values rather than filling them in.");
  }
  if (p.duplicates > 0) add("quality", 0.5, `${p.duplicates} row${p.duplicates === 1 ? " is an exact duplicate" : "s are exact duplicates"} of earlier rows.`, "Duplicates can double-count in totals.");
  for (const c of p.columns.filter((c) => c.unique === 1)) add("quality", 0.3, `${c.name} has the same value in every row.`, "It carries no information and can be dropped.");

  return out.sort((a, b) => b.score - a.score);
}

/** Recommended charts, best first. Each spec is rendered by charts.js. */
export function suggestCharts(p) {
  const out = [];
  const nums = p.columns.filter((c) => c.type === "numeric" && c.stats.std > 0);
  const cats = p.columns.filter((c) => (c.type === "categorical" || c.type === "boolean") && c.unique >= 2 && c.unique <= 30);
  const dates = p.columns.filter((c) => c.type === "datetime");

  if (dates.length && nums.length) {
    out.push({ type: "line", x: dates[0].name, y: nums[0].name, title: `${nums[0].name} over time`, reason: "A date column plus a measure — a line shows the trend." });
    if (nums.length > 1) {
      const series = nums.slice(0, 4).map((c) => c.name);
      out.push({ type: "line", x: dates[0].name, ys: series, index: true, title: `${series.join(", ")} — indexed to 100`, reason: "Several measures on different scales: indexing them to a common start of 100 compares growth on one axis." });
    }
  }
  const pairs = [];
  for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) {
    const r = pearson(nums[i].values, nums[j].values);
    if (r != null) pairs.push([nums[i], nums[j], r]);
  }
  pairs.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
  if (pairs[0] && Math.abs(pairs[0][2]) >= 0.3 && !dates.length) {
    const color = cats.find((c) => c.unique <= 8);
    out.push({ type: "scatter", x: pairs[0][0].name, y: pairs[0][1].name, color: color?.name, title: `${pairs[0][1].name} vs ${pairs[0][0].name}`, reason: `The strongest relationship in the data (r = ${pairs[0][2].toFixed(2)}).` });
  }
  let best = null;
  for (const c of cats) for (const n of nums) {
    const e = groupEffect(c, n);
    if (e && (!best || e.eta2 > best.e.eta2)) best = { c, n, e };
  }
  if (best && best.e.eta2 >= 0.05) out.push({ type: "bar", x: best.c.name, y: best.n.name, agg: "mean", title: `Average ${best.n.name} by ${best.c.name}`, reason: `${best.c.name} makes the biggest difference to ${best.n.name}.` });
  for (const c of cats.slice(0, 2)) out.push({ type: "bar", x: c.name, agg: "count", title: `Rows by ${c.name}`, reason: "How the rows split across categories." });
  for (const n of nums.slice(0, dates.length ? 1 : 2)) out.push({ type: "histogram", x: n.name, title: `Distribution of ${n.name}`, reason: "Shape, spread and outliers of a measure." });
  return out.slice(0, 6);
}

/** Groups rows by `x` and aggregates `y`. Returns [{key, value}] in a sensible order. */
export function aggregate(xCol, yCol, agg) {
  const groups = new Map();
  xCol.values.forEach((k, i) => {
    if (k == null) return;
    const v = yCol ? yCol.values[i] : 1;
    if (yCol && v == null) return;
    const g = groups.get(k) || [];
    g.push(v);
    groups.set(k, g);
  });
  const reduce = {
    count: (a) => a.length,
    sum: (a) => a.reduce((s, v) => s + v, 0),
    mean: (a) => a.reduce((s, v) => s + v, 0) / a.length,
    median: (a) => quantile([...a].sort((x, y) => x - y), 0.5),
    min: (a) => Math.min(...a),
    max: (a) => Math.max(...a),
  }[agg] || ((a) => a.length);
  const out = [...groups].map(([key, a]) => ({ key, value: reduce(a) }));
  if (xCol.type === "numeric" || xCol.type === "datetime") out.sort((a, b) => a.key - b.key);
  else out.sort((a, b) => b.value - a.value);
  return out;
}

/** Equal-width histogram bins (Freedman–Diaconis width, 5–40 bins). */
export function histogram(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return [];
  const min = v[0], max = v[v.length - 1];
  if (min === max) return [{ from: min, to: max, count: v.length }];
  const iqr = quantile(v, 0.75) - quantile(v, 0.25);
  const width = iqr > 0 ? 2 * iqr / Math.cbrt(v.length) : (max - min) / 10;
  const n = Math.max(5, Math.min(40, Math.ceil((max - min) / width)));
  const step = (max - min) / n;
  const bins = Array.from({ length: n }, (_, i) => ({ from: min + i * step, to: min + (i + 1) * step, count: 0 }));
  for (const x of v) bins[Math.min(n - 1, Math.floor((x - min) / step))].count++;
  return bins;
}
