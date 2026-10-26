# InsightForge

**Drop in a dataset and get the story.** Automatic profiling, recommended charts and plain-language insights.

📊 **Live site:** https://nausheen1295.github.io/insightforge/

InsightForge turns a raw CSV into answers in seconds. It works out what each column is, measures it, picks the charts that suit the data, and writes up what stands out, with the numbers behind every finding. Everything runs in your browser tab, so your file is never uploaded.

Part of the Data Lab in my portfolio, [NEXUS](https://nausheen1295.github.io/portfolio/).

## Features

- **Load anything tabular:** CSV, TSV, semicolon- or pipe-separated text, or JSON arrays.
  - Drag and drop, choose a file, or paste data. Files can be up to 50 MB (200,000 rows).
- **Automatic profiling:** each column is classified as number, category, date, yes/no, ID or text.
  - Shows missing values, distinct counts, mean, median, standard deviation, range and outliers (1.5 × IQR).
  - Each column also gets a mini histogram or its top values.
- **Plain-language insights,** ranked by strength:
  - trends over time (start vs end, peak)
  - strong correlations (Pearson r)
  - which category explains the most variation in a measure (η²)
  - skewed distributions, outliers, dominant categories
  - data-quality issues: gaps, duplicate rows, constant columns
  - Every finding shows its evidence, and none claims cause and effect.
- **Recommended charts:**
  - a line chart for date columns, plus several measures indexed to 100 so they compare on one axis
  - a scatter plot of the strongest relationship, coloured by group
  - average by the most influential category, category counts, and histograms
- **Chart builder:** bar, line, scatter or histogram, with count, sum, mean, median, min or max and colour-by. It explains why when a combination doesn't make sense.
- **Correlation heatmap** across numeric columns.
- **Data table** with filtering and sorting.
- **Downloadable report:** a Markdown summary of findings and column profiles.
- **Accessible charts:** every chart has a table view, and colour palettes are colour-blind-checked in both light and dark themes.

## Try it with the samples

| Sample | What InsightForge finds |
|---|---|
| Palmer Penguins | Flipper length and body mass are strongly correlated (r = 0.87). Species explains 78% of the variation in flipper length. |
| Stock prices 2007–2016 | AAPL rose about 740% over the period. Prices correlate strongly, but all are trending over time, and the app says so. |
| Restaurant tips | Tip tracks the total bill (r = 0.68). Bills are right-skewed, and 72% of rows are dinner. |

## How it works

```
File / paste / sample
      │  PapaParse (delimiter sniffing) or JSON.parse
      ▼
js/profile.js   pure analysis engine (unit-tested)
      │  type inference → column stats → correlations, η², skew, outliers, trends
      ├──► insights()      ranked plain-language findings with evidence
      └──► suggestCharts() chart specs chosen from column types and relationships
      ▼
js/charts.js    Chart.js rendering; colours read from CSS tokens per theme
js/app.js       tabs, builder, columns, heatmap, table, report export
```

- **Rule-based insights:** findings come from a statistical engine, not a language model. That makes them fast, private and reproducible, and every sentence can be traced to a number.
- **Type inference:** detection is tolerant of currency symbols, thousands separators, percentages, common "missing" markers (`NA`, `null`, `-`, …) and several date formats.
- **Large files:** long series are evenly thinned for drawing, but all statistics use every row.

## Tech

HTML, CSS and JavaScript (ES modules), [Chart.js](https://www.chartjs.org/) and [PapaParse](https://www.papaparse.com/). There is no build step and no backend.

## Run locally

```bash
git clone https://github.com/Nausheen1295/insightforge.git
cd insightforge
npx serve .          # or: python -m http.server
npm test             # unit tests for the analysis engine (Node 20+)
```

## Sample data credits

- **Palmer Penguins:** Gorman, Williams & Fraser (2014), via [palmerpenguins](https://allisonhorst.github.io/palmerpenguins/). CC0.
- **Tips:** Bryant & Smith (1995), via [seaborn-data](https://github.com/mwaskom/seaborn-data).
- **Stock prices:** Yahoo Finance daily adjusted closes, via [plotly/datasets](https://github.com/plotly/datasets). This is the same data as my [Stock Price Prediction](https://github.com/Nausheen1295/portfolio/tree/main/projects/stock-price-prediction) project.

---

Built by **Nausheen Haleelur Rahman**. [Portfolio](https://nausheen1295.github.io/portfolio/) · [GitHub](https://github.com/Nausheen1295)
