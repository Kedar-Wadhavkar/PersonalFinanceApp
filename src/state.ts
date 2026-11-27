import { CONFIG } from "./config";
import type {
  BarListKind,
  Catalog,
  DashboardView,
  KpiData,
  KpiSide,
  Settings,
  SortDirection,
  SortSetting,
  TableColumn,
  Transaction,
} from "./types";

/* =========================================================================
state.ts
The app's shared data. All files read these variables.

ES modules cannot assign to a variable imported from another file, so each
variable that other files replace has a small setter next to it
(setRows, setAllRows, ...). Reading works directly: an import always sees
the current value.
========================================================================= */

// All loaded records (of the selected currency). Each one looks like:
// { Date: "2025-03-14", Particular, Amount, Category, Mode,
//   Year: "2025", Month: "Mar", Search: "lower-case text of the row" }
// Year is kept as a string everywhere. Month and Search are worked out once
// when the file is loaded (see excel.ts) so filtering stays fast.
export let rows: Transaction[] = [];
export function setRows(list: Transaction[]): void {
  rows = list;
}

// Everything read from the workbook (every currency in the Settings list).
// `rows` above holds only the records of the selected currency, so every
// section of the page follows the currency selector without extra work.
export let allRows: Transaction[] = [];
export function setAllRows(list: Transaction[]): void {
  allRows = list;
}

// The Settings sheet of the workbook (see parseSettings in excel.ts)
export function emptySettings(): Settings {
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
export let settings: Settings = emptySettings();
export function setSettings(value: Settings): void {
  settings = value;
}

// The currency shown now (a code such as "INR"), chosen in the header
export let activeCurrency: string = CONFIG.currency;
export function setActiveCurrency(code: string): void {
  activeCurrency = code;
}

// The same records, ordered by the table's sort column (see table.ts).
// Filtering keeps this order, so the table never has to re-sort.
export let tableRows: Transaction[] = [];
export function setTableRows(list: Transaction[]): void {
  tableRows = list;
}

// What the dashboard currently shows, worked out by computeView()
// (dashboard.ts): the filtered records plus their totals.
export let view: DashboardView = {
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
export function setView(value: DashboardView): void {
  view = value;
}

// Lists derived from `rows` once per load (see refreshCatalog)
export const catalog: Catalog = {
  years: [], // newest first
  categories: [], // A-Z (the dropdowns re-rank them, see filterGroup.ts)
  modes: [], // A-Z
  dateYears: [], // years of the transaction dates, newest first (calendar)
};

// Sort settings of the four bar lists on the main dashboard
export const upperSort: Record<BarListKind, SortSetting> = {
  year: { by: "time", dir: "desc" },
  month: { by: "time", dir: "asc" },
  category: { by: "amount", dir: "desc" },
  mode: { by: "amount", dir: "desc" },
};

// What each of the 4 KPI cards shows: "overall" or "current" (year/month).
// Every card is switched on its own by the two dots in its corner.
export const kpiSides: KpiSide[] = ["overall", "overall", "overall", "overall"];

// Figures behind the KPI cards, worked out by computeKpis() (dashboard.ts)
// from ALL loaded records: the dashboard filters do NOT change them.
export let kpiData: KpiData = {
  sum: 0,
  monthCount: 0, // months that have data, for the monthly average
  categories: new Map(), // category -> total amount
  current: { year: "", month: "", yearSum: 0, monthSum: 0, yearCategories: new Map() },
};
export function setKpiData(value: KpiData): void {
  kpiData = value;
}

// Sort settings of the transactions table
export const txSort: { col: TableColumn; dir: SortDirection } = { col: "Date", dir: "desc" };

// Year currently highlighted in each comparison chart (null = none)
export const highlight: { monthly: string | null; category: string | null } = {
  monthly: null,
  category: null,
};

// Rebuild the catalog after `rows` changes
export function refreshCatalog(): void {
  const years = new Set<string>();
  const dateYears = new Set<string>();
  const modes = new Set<string>();
  const categoryTotals = new Map<string, number>();

  // One pass for every list
  rows.forEach((r) => {
    years.add(r.Year);
    dateYears.add(r.Date.slice(0, 4));
    modes.add(r.Mode);
    categoryTotals.set(r.Category, (categoryTotals.get(r.Category) || 0) + r.Amount);
  });

  const newestFirst = (a: string, b: string) => Number(b) - Number(a);
  catalog.years = [...years].sort(newestFirst);
  catalog.dateYears = [...dateYears].sort(newestFirst);
  catalog.modes = [...modes].sort();
  catalog.categories = [...categoryTotals.keys()].sort();
}
