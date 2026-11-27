/* =========================================================================
state.js
The app's shared data. All files read and change these variables.
========================================================================= */

// All loaded records. Each one looks like:
// { Date: "2025-03-14", Particular, Amount, Category, Mode,
//   Year: "2025", Month: "Mar", Search: "lower-case text of the row" }
// Year is kept as a string everywhere. Month and Search are worked out once
// when the file is loaded (see excel.js) so filtering stays fast.
let rows = [];

// Everything read from the workbook (every currency in the Settings list).
// `rows` above holds only the records of the selected currency, so every
// section of the page follows the currency selector without extra work.
let allRows = [];

// The Settings sheet of the workbook (see parseSettings in excel.js)
function emptySettings() {
    return {
        found: false, // is there a Settings sheet?
        currencies: [], // currency codes, first = default
        ignoreColumns: [],
        ignoreDates: [], // "YYYY-MM-DD"
        ignoreParticulars: [],
        ignoreCategories: [],
        ignoreModes: [],
    };
}
let settings = emptySettings();

// The currency shown now (a code such as "INR"), chosen in the header
let activeCurrency = CONFIG.currency;

// The same records, ordered by the table's sort column (see table.js).
// Filtering keeps this order, so the table never has to re-sort.
let tableRows = [];

// What the dashboard currently shows, worked out by computeView()
// (dashboard.js): the filtered records plus their totals.
let view = {
    records: [], // filtered records, in table order
    sum: 0, // total amount
    groups: {
        // field -> Map(value -> total amount)
        Category: new Map(),
        Year: new Map(),
        Mode: new Map(),
        Month: new Map(),
    },
};

// Lists derived from `rows` once per load (see refreshCatalog)
const catalog = {
    years: [], // newest first
    categories: [], // A-Z (the dropdowns re-rank them, see filterGroup.js)
    modes: [], // A-Z
    dateYears: [], // years of the transaction dates, newest first (calendar)
};

// Sort settings of the four bar lists on the main dashboard
const upperSort = {
    year: { by: "time", dir: "desc" },
    month: { by: "time", dir: "asc" },
    category: { by: "amount", dir: "desc" },
    mode: { by: "amount", dir: "desc" },
};

// What each of the 4 KPI cards shows: "overall" or "current" (year/month).
// Every card is switched on its own by the two dots in its corner.
const kpiSides = ["overall", "overall", "overall", "overall"];

// Figures behind the KPI cards, worked out by computeKpis() (dashboard.js)
// from ALL loaded records: the dashboard filters do NOT change them.
let kpiData = {
  sum: 0,
  monthCount: 0, // months that have data, for the monthly average
  categories: new Map(), // category -> total amount
  current: { year: "", month: "", yearSum: 0, monthSum: 0, yearCategories: new Map() },
};

// Sort settings of the transactions table
const txSort = { col: "Date", dir: "desc" };

// Year currently highlighted in each comparison chart (null = none)
const highlight = { monthly: null, category: null };

// Rebuild the catalog after `rows` changes
function refreshCatalog() {
    const years = new Set();
    const dateYears = new Set();
    const modes = new Set();
    const categoryTotals = new Map();

    // One pass for every list
    rows.forEach((r) => {
        years.add(r.Year);
        dateYears.add(r.Date.slice(0, 4));
        modes.add(r.Mode);
        categoryTotals.set(
            r.Category,
            (categoryTotals.get(r.Category) || 0) + r.Amount,
        );
    });

    const newestFirst = (a, b) => Number(b) - Number(a);
    catalog.years = [...years].sort(newestFirst);
    catalog.dateYears = [...dateYears].sort(newestFirst);
    catalog.modes = [...modes].sort();
    catalog.categories = [...categoryTotals.keys()].sort();
}
