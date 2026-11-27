# Owner guide

A short, plain-language map of this app: what is where, where each money
formula lives, how to change things, and how to run and publish it.

The app is a single web page written in TypeScript, with no framework. Vite
bundles it. It reads your Excel files **inside the browser**: nothing is
uploaded, and the built site blocks every network request
(see `vite.config.ts`).

---

## 1. Folder structure

```
PersonalFinanceApp/
├── index.html            The page itself: side bar, every section, every pop-up
├── styles/main.css       All styling (numbered sections; 17 = shared buttons/chips)
├── src/                  The code (one file per job, see the table below)
├── tests/                Automated tests (Vitest); tests/helpers builds test .xlsx files
├── public/               Copied as-is to the site: icons, sample-workbook.xlsx
├── fonts/                IBM Plex Sans, bundled so the app works offline
├── .github/workflows/    deploy.yml: tests, builds and publishes on every push to main
├── vite.config.ts        Build settings: site path, security policy, offline (PWA) setup
├── vitest.config.ts      Test settings
├── tsconfig.json         TypeScript settings (strict)
└── package.json          The npm commands and the tools they use
```

### The `src/` files

| Area | File | What it does |
|---|---|---|
| Start | `main.ts` | Wires every button, reads chosen files, picks the page to open |
| Settings you may change | `config.ts` | Locale, default currency, currency symbols, month names, chart colours |
| Reading Excel | `excel.ts` | Unzips the .xlsx, finds tables by their headings, makes records |
| | `cellValues.ts` | Reads one cell as a date, an amount (`Rs. 1,200/-`, `(500)`) or a currency |
| Shared data | `state.ts` | The loaded records, filters, sort settings (everyone reads from here) |
| | `types.ts` | The shapes of the data (Transaction, Holding, ...) |
| | `utils.ts` | Money formatting, rounding to cents, today's date, small helpers |
| Expense / Income pages | `modules.ts` | The two modules (sheet names, words like "spending" / "income") |
| | `rebuild.ts` | Redraws every section after a load or a currency change |
| | `dashboard.ts` | KPI cards, the four bar lists, the main filtering pass |
| | `filters.ts`, `filterGroup.ts`, `multiselect.ts` | The Years / Months / Categories / Modes dropdowns |
| | `table.ts` | The transactions table (draws only the rows in view) |
| | `donuts.ts` | Share of Expenditure half donuts |
| | `heatmap.ts` | Daily spending calendar |
| | `lineChart.ts` | Spending trend line chart |
| | `monthlyCompare.ts`, `categoryCompare.ts`, `charts.ts` | Month-wise and category-wise year comparisons |
| | `insights.ts` | The right-hand insights panel |
| | `analyzer.ts`, `recurringPanel.ts` | Recurring bills and unusual entries |
| | `settings.ts` | Currency buttons and the Settings pop-up |
| | `emptyState.ts` | The welcome card before a file is loaded |
| Other pages | `overview.ts` | Overview: income vs expenses, savings |
| | `market.ts` | Market: holdings, XIRR, calendar, treemap, buy history, dividends |
| | `networth.ts` | Net worth: Accounts sheet + market, month by month |
| | `forecast.ts` | The "What if" simulator on the Net worth page |
| Offline | `pwa.ts` | Installable app and the "new version, Reload" note |

---

## 2. Where each financial formula lives

| Figure | Formula | Function (file) |
|---|---|---|
| Amount of a row | Amount + Credit, rounded to cents (Principle is shown, never added) | `parseMatrices` (`excel.ts`) |
| Total, monthly average, top category | sum of amounts; total ÷ months that have data | `computeKpis` (`dashboard.ts`) |
| Month totals | sum per calendar month, rounded to cents | `totalsByMonth` (`insights.ts`) |
| Net saved, savings rate | income − expenses; net ÷ income × 100 | `overviewData`, `renderOverview` (`overview.ts`) |
| Cumulative savings, expense cover | running total of net saved; net saved ÷ average monthly spending (last 12 months) | `renderOverview` (`overview.ts`) |
| "Out of every ₹100" | category ÷ income × 100 | `per100` (`overview.ts`) |
| Holding quantity, average cost, invested | average-cost method over the orders; a sell removes cost at the average | `marketSummary` (`market.ts`) |
| Current value, profit/loss | quantity × LTP (at cost when there is no price); current − invested | `marketSummary` (`market.ts`) |
| XIRR | yearly rate where the dated cash flows add up to zero (bisection) | `mkXirr` (`market.ts`) |
| Held > 1 year | units of the oldest lots still held, bought more than 365 days ago | `marketSummary` (`market.ts`) |
| Net worth | cash + market + other assets − debts, at each month end | `netWorthMonths` (`networth.ts`) |
| Market value in past months | amount still invested at that month end | `marketCostAt` (`networth.ts`) |
| Asset or debt | Type matches loan / card / credit / mortgage ... = debt | `accountKind`, `accountGroup` (`networth.ts`) |
| Forecast averages | income, expenses, discretionary, invested: averages of the last 12 months | `historicalAverages` (`forecast.ts`) |
| Forecast projection | each month: investments × (1 + monthly return) + extra; cash + surplus − extra | `project`, `monthlyRate` (`forecast.ts`) |
| Recurring bills | same merchant, steady monthly or yearly gap, amounts within ±30% | `detectRecurring` (`analyzer.ts`) |
| Unusual entries | at least 2× the category average and 2.5 standard deviations above it | `detectAnomalies` (`analyzer.ts`) |
| Money on screen | whole units, `₹0` never shows a sign | `money`, `signedMoney`, `roundCents` (`utils.ts`) |

Each of these has tests in `tests/` (for example `calculations.test.ts`,
`forecast.test.ts`, `networth.test.ts`). If you change a formula, run
`npm test`, and update the test if the new result is the one you want.

---

## 3. Common changes

### Add or rename a category
You do not change the code for this. Categories, modes and years come
from your workbook: type the new category in the **Category** column and
load the file again. To leave rows out, list them in the `Expense_Settings`
or `Income_Settings` sheet (Ignore Category, Ignore Mode, Ignore Particulars,
Ignore Date, Ignore Columns). The Settings pop-up in the app shows what was
read.

Three places use category or type *names* to decide something:

- **Discretionary spending** (the forecast's "cut" slider): the word list
  `DISCRETIONARY` at the top of `src/forecast.ts`. You can also tick
  categories on and off in the app.
- **Account types** (asset or debt, cash or other): `DEBT_TYPE` and
  `CASH_TYPE` in `src/networth.ts`.
- **Market category colours** (ETF, MutualFund, Stock): `MK_CATEGORY_COLORS`
  in `src/market.ts`.

### Add a currency symbol
Add it to `currencySymbols` in `src/config.ts` (for example `"AED": "AED"`
needs nothing, but a symbol such as `"د.إ": "AED"` needs an entry).

### Change colours or sizes
- Chart colours: `src/config.ts` (comparison bars, donuts).
- Buttons, chips and switches for the whole app: the variables at the top
  of section 17 in `styles/main.css` (`--ctl-height`, `--ctl-on-bg`, ...).
  Change them there and every page follows.

### Add a chart to the Expense / Income pages
1. **Place it** in `index.html`: copy an existing card, for example
   `<section class="card card-gap" id="secTrend">`, and give it a new id
   and an empty `<div id="myChart"></div>`.
2. **Draw it** in a new file `src/myChart.ts`. Read the records from
   `rows` (`state.ts`, already filtered to the chosen currency) and add
   them up. Format money with `money()` from `utils.ts`, then write the
   HTML or SVG into `document.getElementById("myChart")`.
3. **Call it**: import your function in `src/rebuild.ts` and call it at the
   end of `rebuildAll()`, so it redraws after every load and currency
   change. If it should follow the main filters, call it from `render()`
   in `dashboard.ts` and use `view.records` instead of `rows`.
4. Optionally, add a link to it in the side bar's "On this page" list in
   `index.html`.
5. **Test it**: add a test in `tests/` (copy the style of
   `calculations.test.ts`) and run `npm test`.

The Overview, Market and Net worth pages work the same way. Each draws
everything in one function (`renderOverview`, `renderMarket`,
`renderNetWorth`), so a new card there is one more block of HTML in that
function.

---

## 4. Run it on your computer

You need **Node.js 20 or newer** (https://nodejs.org, the LTS version) and
**Git**.

```bash
# 1. Get the code (once)
git clone https://github.com/Kedar-Wadhavkar/PersonalFinanceApp.git
cd PersonalFinanceApp

# 2. Install the tools (once, and again after package.json changes)
npm install

# 3. Start the app with live reload
npm run dev
```

Open **http://localhost:5173/PersonalFinanceApp/** (note the
`/PersonalFinanceApp/` at the end). Click **Load Excel** and try
`public/sample-workbook.xlsx`. When you save a file in `src/` or `styles/`,
the page updates by itself. Press `Ctrl+C` in the terminal to stop.

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Runs every test once (they must pass before the site updates) |
| `npm run build` | Checks types, then builds the site into `dist/` |
| `npm run preview` | Serves the built `dist/` (closest to the live site, offline mode included) |
| `npm run typecheck` | Only the TypeScript check |

You can't open `index.html` by double-clicking it. Use `npm run dev`.

---

## 5. Update the live site (GitHub Pages)

The site is **https://kedar-wadhavkar.github.io/PersonalFinanceApp/**. It
updates **by itself** whenever `main` changes:

```bash
npm test && npm run build      # 1. check locally first
git checkout -b my-change      # 2. work on a branch
git add -A
git commit -m "Describe the change"
git push -u origin my-change   # 3. then open a pull request on GitHub and merge it
```

After the merge, GitHub Actions runs `.github/workflows/deploy.yml`:
`npm ci` → `npm test` → `npm run build` → publish `dist/`. Watch it under
the repository's **Actions** tab. It takes about a minute, and a green tick
means it is live.

- **A test fails:** the site is not updated and the old version stays
  online. Open the failed run in Actions to see which test, fix it, and
  push again.
- **Run it again without a change:** Actions → "Deploy to GitHub Pages" →
  **Run workflow**.
- **Already open on a phone or desktop:** the app shows a "new version,
  Reload" note. It never reloads by itself, so a loaded workbook is not
  lost.
- **One-time setting** (already done): repository Settings → Pages → Source
  = **GitHub Actions**.

---

## 6. Keep your data private

- **Never commit a real workbook.** `.gitignore` blocks every `.xlsx`
  except `public/sample-workbook.xlsx`. Tests build their own fake
  workbooks.
- Workbooks are read into memory only. They are not saved, cached or sent
  anywhere, and refreshing the page clears them.
