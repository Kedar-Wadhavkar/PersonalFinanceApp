import type { Transaction } from "./types";

/* =========================================================================
analyzer.ts
A rule-based look through the transactions for two things:

  1. Recurring bills and subscriptions
     Entries are grouped by merchant: the Particulars text is cleaned
     (case, numbers, month names, dates and filler words such as "bill" or
     "payment" are dropped) and names that are spelt a little differently
     ("Netflix.com", "NETFLIX subscription") are merged. A group is
     recurring when its payments come at a steady monthly or yearly
     interval and the amounts stay close to each other.

  2. Spending anomalies
     An entry is unusual when it is far above the other entries of its
     category: at least `anomalyRatio` times the category average AND at
     least `anomalyZ` standard deviations above it. The entry itself is
     left out of its category's average, so one huge entry cannot hide
     itself by pulling the average up.

Pure functions only (no page, no state), so they are easy to test.
========================================================================= */

export type Frequency = "monthly" | "annual";

export interface RecurringItem {
  /** Cleaned merchant name used for matching, e.g. "netflix" */
  key: string;
  /** The Particulars text of the latest payment, for display */
  name: string;
  /** Most common category of the payments */
  category: string;
  currency: string;
  frequency: Frequency;
  /** Number of payments found */
  count: number;
  /** Median payment */
  typicalAmount: number;
  lastAmount: number;
  /** "YYYY-MM-DD" */
  firstDate: string;
  lastDate: string;
  /** When the next payment is expected, "YYYY-MM-DD" */
  nextDate: string;
  /** Median days between payments */
  intervalDays: number;
  /** Cost over a year: typical amount × 12 (monthly) or × 1 (annual) */
  annualCost: number;
  /** false when the expected payment is well overdue (it seems to have stopped) */
  active: boolean;
  /** The payments, oldest first */
  records: Transaction[];
}

export type Severity = "medium" | "high";

export interface Anomaly {
  record: Transaction;
  category: string;
  /** Average of the OTHER entries of the category (same currency) */
  categoryAverage: number;
  /** amount ÷ categoryAverage */
  ratio: number;
  /** Standard deviations above the category average */
  zScore: number;
  severity: Severity;
}

export interface AnalyzerOptions {
  /** Payments needed before a monthly series counts (default 3) */
  minMonthlyCount: number;
  /** Payments needed before a yearly series counts (default 2) */
  minAnnualCount: number;
  /** Share of payments that must stay within `amountTolerance` of the median (default 0.8) */
  amountConsistency: number;
  /** How far a payment may be from the median, as a share of it (default 0.3 = ±30%) */
  amountTolerance: number;
  /** Share of gaps that must fit the interval (default 0.75) */
  intervalConsistency: number;
  /** Merchant names at least this similar (0..1) are merged (default 0.85) */
  nameSimilarity: number;
  /** A series is no longer active when this many intervals passed without a payment (default 1.5) */
  staleAfterIntervals: number;
  /** Other entries a category needs before its entries can be flagged (default 5) */
  minCategorySize: number;
  /** Times the category average an entry must reach (default 2) */
  anomalyRatio: number;
  /** Standard deviations above the average an entry must reach (default 2.5) */
  anomalyZ: number;
  /** Ratio from which an anomaly counts as "high" (default 3) */
  highRatio: number;
  /** The day "now" is measured from; default = the latest date in the data */
  today?: string;
}

export const DEFAULT_OPTIONS: AnalyzerOptions = {
  minMonthlyCount: 3,
  minAnnualCount: 2,
  amountConsistency: 0.8,
  amountTolerance: 0.3,
  intervalConsistency: 0.75,
  nameSimilarity: 0.85,
  staleAfterIntervals: 1.5,
  minCategorySize: 5,
  anomalyRatio: 2,
  anomalyZ: 2.5,
  highRatio: 3,
};

/** Day ranges that count as one interval of each kind. */
export const INTERVALS: Record<Frequency, { min: number; max: number; perYear: number }> = {
  monthly: { min: 25, max: 35, perYear: 12 },
  annual: { min: 335, max: 395, perYear: 1 },
};

/* ------------ Small helpers ------------ */

const DAY = 86_400_000;

/** "YYYY-MM-DD" -> whole days since 1970 (UTC, so time zones never matter). */
export function dayNumber(iso: string): number {
  return Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY);
}

export function isoFromDay(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

/** "2026-01-31" + 1 month -> "2026-02-28" (the day is kept where the month allows). */
export function addMonths(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + months;
  const d = Number(iso.slice(8, 10));
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, last))).toISOString().slice(0, 10);
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/* ------------ Merchant names ------------ */

const MONTH_WORDS = new Set([
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
]);

// Words that say how something was paid, not who was paid
const FILLER_WORDS = new Set([
  "bill", "bills", "payment", "paid", "pay", "monthly", "yearly", "annual", "annually", "renewal", "renew",
  "subscription", "sub", "autopay", "auto", "debit", "recurring", "plan", "fee", "fees", "charge", "charges",
  "upi", "neft", "imps", "rtgs", "ach", "nach", "ecs", "si", "txn", "ref", "inv", "invoice", "no", "for", "to",
  "the", "of", "a", "an", "and", "via", "online", "www", "com", "in", "co", "net", "org", "inc", "ltd", "pvt",
]);

/**
 * The part of a Particulars text that names the merchant, lower case:
 * "NETFLIX.COM Subscription - Nov 2026 #4471" -> "netflix".
 * Gives "" when nothing is left (the entry cannot be matched).
 */
export function normalizeMerchant(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w && !/\d/.test(w) && !MONTH_WORDS.has(w) && !FILLER_WORDS.has(w));
  return words.join(" ");
}

/** Edit distance between two strings (insert, delete, change one letter). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * How alike two cleaned merchant names are, 0..1. Names count as the same
 * merchant (1) when one is the other plus extra words at the end
 * ("amazon prime" / "amazon prime video"); otherwise 1 − edit distance
 * ÷ length of the longer name.
 */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 4 && long.startsWith(short + " ")) return 1;
  return 1 - levenshtein(a, b) / long.length;
}

/* ------------ Recurring bills ------------ */

interface Group {
  key: string;
  currency: string;
  records: Transaction[];
}

/** Records grouped by currency + merchant, similar names merged. */
export function groupByMerchant(records: Transaction[], similarity = DEFAULT_OPTIONS.nameSimilarity): Group[] {
  const exact = new Map<string, Group>();
  for (const r of records) {
    if (!(r.Amount > 0)) continue; // refunds and empty rows are not bills
    const key = normalizeMerchant(r.Particular || "");
    if (!key) continue;
    const id = `${r.Currency}\u0000${key}`;
    let g = exact.get(id);
    if (!g) exact.set(id, (g = { key, currency: r.Currency, records: [] }));
    g.records.push(r);
  }
  // Merge similar names, the most used name of each cluster leading
  const groups = [...exact.values()].sort((a, b) => b.records.length - a.records.length || a.key.localeCompare(b.key));
  const merged: Group[] = [];
  for (const g of groups) {
    const into = merged.find((m) => m.currency === g.currency && nameSimilarity(m.key, g.key) >= similarity);
    if (into) into.records.push(...g.records);
    else merged.push({ ...g, records: [...g.records] });
  }
  for (const g of merged) g.records.sort((a, b) => a.Date.localeCompare(b.Date));
  return merged;
}

/**
 * Is this series of payments monthly, yearly, or neither? Several payments
 * on the same day count once. Gaps of two or three months in a monthly
 * series (a missed entry) are allowed as long as most gaps fit.
 */
export function detectFrequency(dates: string[], opts: Partial<AnalyzerOptions> = {}): { frequency: Frequency; intervalDays: number } | null {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const days = [...new Set(dates.map(dayNumber))].sort((a, b) => a - b);
  if (days.length < 2) return null;
  const gaps = days.slice(1).map((d, i) => d - days[i]!);
  const mid = median(gaps);
  for (const frequency of ["monthly", "annual"] as Frequency[]) {
    const { min, max } = INTERVALS[frequency];
    const need = frequency === "monthly" ? o.minMonthlyCount : o.minAnnualCount;
    if (days.length < need || mid < min || mid > max) continue;
    // A gap fits when it is one interval, or (monthly only) a whole number of them
    const fits = gaps.filter((g) => {
      if (g >= min && g <= max) return true;
      if (frequency !== "monthly") return false;
      const n = Math.round(g / 30.44);
      return n >= 2 && n <= 3 && g >= min * n && g <= max * n;
    }).length;
    if (fits / gaps.length >= o.intervalConsistency) return { frequency, intervalDays: mid };
  }
  return null;
}

/** Do the amounts stay close to their median? */
export function amountsConsistent(amounts: number[], opts: Partial<AnalyzerOptions> = {}): boolean {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const mid = median(amounts);
  if (!(mid > 0)) return false;
  const close = amounts.filter((a) => Math.abs(a - mid) <= mid * o.amountTolerance).length;
  return close / amounts.length >= o.amountConsistency;
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best = "";
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

const latestDate = (records: Transaction[]): string => records.reduce((a, r) => (r.Date > a ? r.Date : a), "");

/** Recurring bills and subscriptions found in the records, the largest yearly cost first. */
export function detectRecurring(records: Transaction[], opts: Partial<AnalyzerOptions> = {}): RecurringItem[] {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const today = o.today || latestDate(records);
  const items: RecurringItem[] = [];
  for (const g of groupByMerchant(records, o.nameSimilarity)) {
    const found = detectFrequency(g.records.map((r) => r.Date), o);
    if (!found) continue;
    const amounts = g.records.map((r) => r.Amount);
    if (!amountsConsistent(amounts, o)) continue;
    const last = g.records[g.records.length - 1]!;
    const typicalAmount = median(amounts);
    const nextDate = found.frequency === "monthly" ? addMonths(last.Date, 1) : addMonths(last.Date, 12);
    const overdue = dayNumber(today) - dayNumber(last.Date);
    items.push({
      key: g.key,
      name: last.Particular,
      category: mostCommon(g.records.map((r) => r.Category)),
      currency: g.currency,
      frequency: found.frequency,
      count: g.records.length,
      typicalAmount,
      lastAmount: last.Amount,
      firstDate: g.records[0]!.Date,
      lastDate: last.Date,
      nextDate,
      intervalDays: found.intervalDays,
      annualCost: typicalAmount * INTERVALS[found.frequency].perYear,
      active: overdue <= found.intervalDays * o.staleAfterIntervals,
      records: g.records,
    });
  }
  return items.sort((a, b) => Number(b.active) - Number(a.active) || b.annualCost - a.annualCost || a.key.localeCompare(b.key));
}

/** Yearly cost of the recurring items that are still active. */
export function annualRecurringCost(items: RecurringItem[]): number {
  return items.reduce((sum, i) => sum + (i.active ? i.annualCost : 0), 0);
}

/* ------------ Anomalies ------------ */

/** Entries unusually high for their category, the most unusual first. */
export function detectAnomalies(records: Transaction[], opts: Partial<AnalyzerOptions> = {}): Anomaly[] {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  // Sum, sum of squares and count per currency + category
  const stats = new Map<string, { n: number; sum: number; sq: number }>();
  const idOf = (r: Transaction) => `${r.Currency}\u0000${r.Category}`;
  const usable = records.filter((r) => r.Amount > 0);
  for (const r of usable) {
    const id = idOf(r);
    const s = stats.get(id) || { n: 0, sum: 0, sq: 0 };
    s.n++;
    s.sum += r.Amount;
    s.sq += r.Amount * r.Amount;
    stats.set(id, s);
  }
  const found: Anomaly[] = [];
  for (const r of usable) {
    const s = stats.get(idOf(r))!;
    // The category WITHOUT this entry
    const n = s.n - 1;
    if (n < o.minCategorySize) continue;
    const mean = (s.sum - r.Amount) / n;
    const variance = Math.max(0, (s.sq - r.Amount * r.Amount) / n - mean * mean);
    const sd = Math.sqrt(variance);
    const ratio = r.Amount / mean;
    // All other entries equal (sd 0): the ratio alone decides
    const zScore = sd > mean * 1e-9 ? (r.Amount - mean) / sd : Number.POSITIVE_INFINITY;
    if (ratio < o.anomalyRatio || zScore < o.anomalyZ) continue;
    found.push({
      record: r,
      category: r.Category,
      categoryAverage: mean,
      ratio,
      zScore,
      severity: ratio >= o.highRatio ? "high" : "medium",
    });
  }
  return found.sort((a, b) => b.ratio - a.ratio || b.record.Amount - a.record.Amount);
}

/* ------------ Both at once ------------ */

export interface AnalysisResult {
  recurring: RecurringItem[];
  anomalies: Anomaly[];
  /** Yearly cost of the active recurring items */
  annualCost: number;
}

export function analyzeTransactions(records: Transaction[], opts: Partial<AnalyzerOptions> = {}): AnalysisResult {
  const recurring = detectRecurring(records, opts);
  return { recurring, anomalies: detectAnomalies(records, opts), annualCost: annualRecurringCost(recurring) };
}
