# PersonalFinanceApp

Personal Finance Analytics: an offline, browser-based dashboard built from one Excel workbook.

## Modules

- **Overview**: income vs expense, savings, cumulative savings, expense cover
- **Expense** and **Income**: KPIs, monthly trends, category donuts, heatmap, comparisons, searchable table
- **Market**: investments from an order log and holdings/prices sheet (calendar, treemap, invested vs current, buy history)
- Coming later: Net worth, Loans, Budgets

## Live site

Every push to `main` is built and published to GitHub Pages by
`.github/workflows/deploy.yml`:
https://kedar-wadhavkar.github.io/PersonalFinanceApp/

Your workbook is read in the browser only; nothing is uploaded.

## How to use

1. Open the live site (or run it locally, see below).
2. Click **Load Excel** and pick your workbook (you can pick several files at once, e.g. a separate market workbook).
3. Try it with `public/sample-workbook.xlsx` first (also on the site at `/PersonalFinanceApp/sample-workbook.xlsx`).

## Development

Needs Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:5173/PersonalFinanceApp/
npm run typecheck  # strict TypeScript check
npm run build      # type check + production build into dist/
npm run preview    # serve dist/ locally
```

The app is plain TypeScript (no framework), bundled by Vite. Because it is
now built from ES modules, `index.html` no longer opens by double-click: use
`npm run dev` or the live site.

## Workbook format

Sheets: `Expense`, `Income`, `Expense_Settings`, `Income_Settings`.
Income columns: Date, Particulars, Currency, Amount, Principle, Category, Mode.

Market tables are found by their headings: orders (Date, Order, Holding, Units, UnitAvg), holdings (Holding, LTP, Category, Sector, SubSector) and optional dividends (Date, Holding, Amount).

## Project layout

- `index.html`: page shell (Vite entry, loads `src/main.ts`)
- `src/main.ts`: start-up and event wiring
- `src/types.ts`: interfaces for parsed Excel rows, transactions, settings, categories and summary metrics
- `src/state.ts`: shared app state
- `src/excel.ts`: reads .xlsx files with no libraries
- `src/*.ts`: one file per section (dashboard, charts, calendar, overview, market, ...)
- `styles/main.css`: styles
- `fonts/`: IBM Plex Sans, bundled locally (SIL Open Font License)
- `public/`: files copied to the site as they are
- `vite.config.ts`, `tsconfig.json`: build and strict type-check settings

Your data stays in your browser. Keep real workbooks out of this repository.
