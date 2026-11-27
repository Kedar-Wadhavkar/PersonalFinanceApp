# PersonalFinanceApp

Personal Finance Analytics: an offline, browser-based dashboard built from one Excel workbook.

## Modules

- **Overview**: income vs expense, savings, cumulative savings, expense cover
- **Expense** and **Income**: KPIs, monthly trends, category donuts, heatmap, comparisons, searchable table
- **Market**: investments from an order log and holdings/prices sheet (calendar, treemap, invested vs current, buy history)
- Coming later: Net worth, Loans, Budgets

## How to use

1. Open `index.html` in a browser (no server or install needed).
2. Click **Load Excel** and pick your workbook (you can pick several files at once, e.g. a separate market workbook).
3. Try it with `sample-workbook.xlsx` first.

## Workbook format

Sheets: `Expense`, `Income`, `Expense_Settings`, `Income_Settings`.
Income columns: Date, Particulars, Currency, Amount, Principle, Category, Mode.

Market tables are found by their headings: orders (Date, Order, Holding, Units, UnitAvg), holdings (Holding, LTP, Category, Sector, SubSector) and optional dividends (Date, Holding, Amount).

## Project layout

- `index.html`: page shell
- `src/`: plain JavaScript modules (parsing, charts, pages)
- `styles/main.css`: styles
- `fonts/`: IBM Plex Sans, bundled locally (SIL Open Font License)

Your data stays in your browser. Keep real workbooks out of this repository.
