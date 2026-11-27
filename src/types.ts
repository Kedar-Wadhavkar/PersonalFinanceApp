/* =========================================================================
types.ts
The shapes of the data the app works with: what is read from the Excel
workbook, the records made from it, and the figures worked out from them.
========================================================================= */

/* ------------ Raw workbook ------------ */

/** One cell as read from the sheet XML: a number, text, or nothing. */
export type CellValue = string | number;

/** grid[rowIndex][columnIndex]. Rows and cells may be missing (sparse). */
export type SheetGrid = (CellValue[] | undefined)[];

/** One sheet of a workbook, in tab order. */
export interface SheetMatrix {
  name: string;
  grid: SheetGrid;
}

/* ------------ Modules (Expense, Income) ------------ */

export type ModuleKey = "expense" | "income";

/** The words a module puts into the page ("spending" / "income"). */
export interface ModuleText {
  noun: string;
  flow: string;
  Flow: string;
  Share: string;
  none: string;
  noDay: string;
}

export type ModuleTextKey = keyof ModuleText;

export interface ModuleDefinition {
  title: string;
  /** Sheet name, lower case, spaces/dashes as "_" */
  sheet: string;
  /** Settings sheets, first found wins */
  settingsSheets: string[];
  settingsLabel: string;
  /** A workbook WITHOUT module sheets is read as this module */
  legacy: boolean;
  text: ModuleText;
}

/* ------------ Settings sheet ------------ */

export interface Settings {
  /** Is there a Settings sheet? */
  found: boolean;
  /** Currency codes, first = default */
  currencies: string[];
  ignoreColumns: string[];
  /** "YYYY-MM-DD" */
  ignoreDates: string[];
  ignoreParticulars: string[];
  ignoreCategories: string[];
  ignoreModes: string[];
}

/** The list fields of Settings (everything except `found`). */
export type SettingsListKey = Exclude<keyof Settings, "found">;

/* ------------ Transactions ------------ */

/** Short month name as used in CONFIG.months ("Jan" ... "Dec"). */
export type MonthName = string;

/** One row of an Expense or Income table. */
export interface Transaction {
  /** "YYYY-MM-DD" */
  Date: string;
  Particular: string;
  /** Amount + Credit */
  Amount: number;
  /** "Principle" column of the Income sheet (shown, not added to totals) */
  Principal: number | null;
  Category: string;
  Mode: string;
  /** Currency code, e.g. "INR" */
  Currency: string;
  /** Year heading of the table (or the date's year), kept as a string */
  Year: string;
  /** Month of the date, e.g. "Mar" */
  Month: MonthName;
  /** Lower-case text of the row, for the search box */
  Search: string;
}

/** Fields a transaction can be grouped by on the dashboard. */
export type GroupField = "Category" | "Year" | "Mode" | "Month";

/** Text fields the transactions table can sort by. */
export type TextColumn = "Particular" | "Category" | "Mode";
export type TableColumn = "Date" | "Amount" | TextColumn;

/** Rows left out while reading a module, never dropped silently. */
export interface SkippedRows {
  count: number;
  samples: string[];
}

/** What parseMatrices() gives one module. */
export interface ModuleParseResult {
  records: Transaction[];
  skipped: SkippedRows;
  settings: Settings;
  settingsSheetName: string;
  sheetNames: string[];
}

/* ------------ Summary metrics ------------ */

/** Name -> total amount */
export type Totals = Map<string, number>;

/** What the dashboard shows now: filtered records and their totals. */
export interface DashboardView {
  records: Transaction[];
  sum: number;
  groups: Record<GroupField, Totals>;
}

/** Figures behind the KPI cards (all records, filters ignored). */
export interface KpiData {
  sum: number;
  /** Months that have data, for the monthly average */
  monthCount: number;
  categories: Totals;
  current: {
    year: string;
    month: MonthName;
    yearSum: number;
    monthSum: number;
    yearCategories: Totals;
  };
}

export type KpiSide = "overall" | "current";

/** Lists derived from the records once per load. */
export interface Catalog {
  /** Newest first */
  years: string[];
  categories: string[];
  modes: string[];
  /** Years of the transaction dates, newest first */
  dateYears: string[];
}

export type SortDirection = "asc" | "desc";
export type SortBy = "time" | "amount" | "name";
export type BarListKind = "year" | "month" | "category" | "mode";

export interface SortSetting {
  by: SortBy;
  dir: SortDirection;
}

/** One month of the Overview: income, expenses and net saved. */
export interface MonthSummary {
  /** Month index: year * 12 + month (0 = January) */
  m: number;
  inc: number;
  exp: number;
  net: number;
}

export interface OverviewData {
  income: Transaction[];
  expense: Transaction[];
  incM: Map<number, number>;
  expM: Map<number, number>;
  months: MonthSummary[];
  first: number;
  last: number;
  /** Latest month BOTH sheets reached */
  bothLast: number;
}

/* ------------ Market ------------ */

export type OrderType = "Buy" | "Sell";

export interface MarketOrder {
  /** "YYYY-MM-DD" */
  date: string;
  type: OrderType;
  holding: string;
  units: number;
  price: number;
  value: number;
  charges: number;
  index: number | null;
  eqUnits: number | null;
}

/** A row of the holdings / prices table. */
export interface HoldingInfo {
  category: string;
  sector: string;
  subSector: string;
  ltp: number | null;
  qty: number | null;
  avg: number | null;
}

export interface Dividend {
  date: string;
  holding: string;
  amount: number;
}

export interface MarketData {
  orders: MarketOrder[];
  info: Map<string, HoldingInfo>;
  dividends: Dividend[];
  skipped: number;
  sheetNames: string[];
}

/** A dated cash flow for XIRR (negative = money in). */
export interface CashFlow {
  d: string;
  v: number;
}

/** One holding, worked out from the orders and its price. */
export interface Holding {
  name: string;
  qty: number;
  invested: number;
  realised: number;
  charges: number;
  lots: { date: string; units: number }[];
  flows: CashFlow[];
  first?: string;
  last?: string;
  noOrders?: boolean;
  category: string;
  sector: string;
  ltp: number | null;
  avg: number;
  current: number;
  pnl: number;
  pct: number;
  ltQty: number;
  xirr: number | null;
  share: number;
}

export interface MarketSummary {
  held: Holding[];
  all: Holding[];
  invested: number;
  current: number;
  pnl: number;
  realised: number;
  charges: number;
  xirr: number | null;
  bench: { value: number; index: number; date: string } | null;
  noPrice: Holding[];
}
