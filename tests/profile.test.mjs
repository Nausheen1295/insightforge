import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inferType, toNumber, toDate, profile, pearson, insights, suggestCharts, histogram, aggregate } from "../js/profile.js";

// Minimal CSV reader for the bundled samples (no quoted commas in them).
function csv(file) {
  const [head, ...lines] = readFileSync(new URL(`../samples/${file}`, import.meta.url), "utf8").trim().split(/\r?\n/);
  const strip = (s) => s.replace(/^"|"$/g, "");
  return { columns: head.split(",").map(strip), rows: lines.map((l) => l.split(",").map(strip)) };
}

test("numbers, dates and missing values parse", () => {
  assert.equal(toNumber("1,234.5"), 1234.5);
  assert.equal(toNumber("$12"), 12);
  assert.equal(toNumber("12%"), 12);
  assert.equal(toNumber("abc"), null);
  assert.equal(toDate("2024-03-01"), Date.UTC(2024, 2, 1));
  assert.equal(toDate("25/12/2024"), Date.UTC(2024, 11, 25));
  assert.equal(toDate("12/25/2024"), Date.UTC(2024, 11, 25));
  assert.equal(toDate("hello"), null);
});

test("column types are inferred", () => {
  assert.equal(inferType(["1", "2.5", "", "NA"]), "numeric");
  assert.equal(inferType(["2024-01-01", "2024-02-01"]), "datetime");
  assert.equal(inferType(["yes", "no", "yes"]), "boolean");
  assert.equal(inferType(["red", "blue", "red", "red"]), "categorical");
  assert.equal(inferType(["1", "2", "3"], "customer_id"), "identifier");
  assert.equal(inferType(["", "NA"]), "empty");
});

test("pearson correlation", () => {
  assert.ok(Math.abs(pearson([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-12);
  assert.ok(Math.abs(pearson([1, 2, 3, 4], [8, 6, 4, 2]) + 1) < 1e-12);
  assert.equal(pearson([1, null], [2, 3]), null);
});

test("penguins: profile, insights and charts", () => {
  const { columns, rows } = csv("penguins.csv");
  const p = profile(columns, rows);
  assert.equal(p.rowCount, 344);
  const mass = p.columns.find((c) => c.name === "body_mass_g");
  assert.equal(mass.type, "numeric");
  assert.equal(mass.missing, 2);
  assert.equal(p.columns.find((c) => c.name === "species").type, "categorical");
  const top = insights(p)[0];
  assert.equal(top.kind, "correlation");
  assert.match(top.text, /flipper_length_mm and body_mass_g .* \(r = 0\.87\)/);
  const charts = suggestCharts(p);
  assert.equal(charts[0].type, "scatter");
  assert.equal(charts[0].color, "species");
});

test("stock prices: detects the date column and trends", () => {
  const { columns, rows } = csv("stock_prices.csv");
  const p = profile(columns, rows);
  assert.equal(p.columns.find((c) => c.name === "Date").type, "datetime");
  const aapl = insights(p).find((i) => i.kind === "trend" && i.text.startsWith("AAPL"));
  assert.match(aapl.text, /AAPL rose \d+% between 2007-01-03 and 2016-03-01/);
  assert.equal(suggestCharts(p)[0].type, "line");
});

test("histogram and aggregation", () => {
  const bins = histogram([1, 2, 2, 3, 3, 3, 4, 4, 5, 10]);
  assert.equal(bins.reduce((a, b) => a + b.count, 0), 10);
  const x = { type: "categorical", values: ["a", "b", "a", null] };
  const y = { type: "numeric", values: [1, 5, 3, 9] };
  assert.deepEqual(aggregate(x, y, "mean"), [{ key: "b", value: 5 }, { key: "a", value: 2 }]);
  assert.deepEqual(aggregate(x, null, "count"), [{ key: "a", value: 2 }, { key: "b", value: 1 }]);
});
