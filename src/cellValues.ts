/* =========================================================================
cellValues.ts
Reading one cell as a date, an amount or a currency. Shared by the workbook reader
(excel.ts, loaded only when a file is picked) and the market page, so the
market page does not pull the whole reader into the first download.
========================================================================= */

import { CONFIG } from "./config";

// Month names in text dates: "Mar", "March", "Sept" (English, any case)
const MONTH_WORDS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const monthFromWord = (word: string): number | undefined => {
  const w = word.toLowerCase();
  return MONTH_WORDS[w] ?? MONTH_WORDS[w.slice(0, 3)];
};

// Text dates: dd-mm-yyyy (also dd/mm/yyyy, dd.mm.yyyy), yyyy-mm-dd and
// dd-Mon-yyyy / dd Month yy (Excel's own "14-Mar-25" style), with an
// optional time after them. Built with Date.UTC, so the day never shifts
// with the time zone. Returns null for impossible dates (31-02-2025).
export function parseTextDate(text: unknown): Date | null {
  const s = String(text).trim();
  let y: number, m: number, d: number;
  let parts: RegExpMatchArray | null;
  if ((parts = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:[ T].*)?$/))) {
    d = Number(parts[1]);
    m = Number(parts[2]);
    y = Number(parts[3]);
  } else if ((parts = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T].*)?$/))) {
    y = Number(parts[1]);
    m = Number(parts[2]);
    d = Number(parts[3]);
  } else if ((parts = s.match(/^(\d{1,2})[-\/. ]+([a-z]{3,9})\.?[-\/. ,]+(\d{4}|\d{2})(?:[ T].*)?$/i))) {
    const month = monthFromWord(parts[2]!);
    if (!month) return null;
    d = Number(parts[1]);
    m = month;
    // Two-digit years are this century: "25" -> 2025
    y = parts[3]!.length === 2 ? 2000 + Number(parts[3]) : Number(parts[3]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  const real =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d;
  return real ? date : null;
}

// A cell -> a UTC Date, or null. Excel stores dates as day numbers; text
// dates go through parseTextDate().
export function excelDate(v: unknown): Date | null {
  if (typeof v === "number") {
    return v > 0
      ? new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000))
      : null;
  }
  const s = String(v ?? "").trim();
  if (!s) return null;
  const parsed = parseTextDate(s);
  if (parsed) return parsed;
  // Month written as a word ("14 Mar 2025"): keep the calendar day as typed
  if (/[a-z]{3}/i.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  return null;
}

// Currency marks written next to an amount: "Rs.", "INR", "₹", "$" ...
// ("Rs" or a three-letter code; a single letter such as the "k" of "5k" is not one)
const CURRENCY_MARK = /^(?:rs\.?|[a-z]{3}\.?|[₹$€£¥])/i;
const CURRENCY_MARK_END = /(?:rs\.?|[a-z]{3}\.?|[₹$€£¥])$/i;

// A cell -> a number, null when it is empty, NaN when it is not a number.
// Numbers are used as they are. Text is read only when it is clearly an
// amount: "1,234", "Rs. 1,200/-", "1,500 INR", "(500)" and "−300" (both
// negative). Anything else ("N/A", "12 apples", "12-500") gives NaN, so the
// row is counted as skipped instead of being read with a wrong amount.
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  const text = String(raw ?? "").trim();
  if (!text) return null;

  let s = text
    .replace(/[\s\u00a0,]/g, "") // spaces and digit grouping
    .replace(/[\u2212\u2012\u2013]/g, "-") // minus sign and dashes
    .replace(/\/-$/, ""); // "1200/-"
  let negative = false;
  // Accounting style: (1,234) is -1234
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // A sign and a currency mark, in either order, before the number
  for (let i = 0; i < 2; i++) {
    if (/^-/.test(s)) {
      negative = !negative;
      s = s.slice(1);
    } else if (/^\+/.test(s)) {
      s = s.slice(1);
    }
    s = s.replace(CURRENCY_MARK, "");
  }
  s = s.replace(CURRENCY_MARK_END, "");
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  const n = Number(s);
  return negative ? -n : n;
}

// "¥" -> "JPY", "inr" -> "INR", "" -> ""
export function normalizeCurrency(raw: unknown): string {
  const text = String(raw ?? "").trim();
  return text ? CONFIG.currencySymbols[text] || text.toUpperCase() : "";
}
