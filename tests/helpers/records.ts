import { CONFIG } from "../../src/config";
import type { Transaction } from "../../src/types";

/** One transaction, with the derived fields filled in as the parser does. */
export function rec(
  date: string,
  amount: number,
  category = "Food",
  mode = "Cash",
  extra: Partial<Transaction> = {},
): Transaction {
  const r: Transaction = {
    Date: date,
    Particular: extra.Particular ?? `${category} on ${date}`,
    Amount: amount,
    Principal: null,
    Category: category,
    Mode: mode,
    Currency: "INR",
    Year: date.slice(0, 4),
    Month: CONFIG.months[Number(date.slice(5, 7)) - 1]!,
    Search: "",
    ...extra,
  };
  r.Search = [r.Date, r.Particular, r.Amount, r.Category, r.Mode, r.Currency, r.Year, r.Principal ?? ""].join(" ").toLowerCase();
  return r;
}

/** A small but realistic year and a bit of spending, used by several tests. */
export const SPENDING: Transaction[] = [
  rec("2025-11-03", 500, "Food", "Cash"),
  rec("2025-11-20", 1500, "Rent", "Bank"),
  rec("2025-12-05", 700, "Food", "UPI"),
  rec("2025-12-24", 3000, "Gifts", "Card"),
  rec("2026-01-10", 800, "Food", "UPI"),
  rec("2026-01-15", 1500, "Rent", "Bank"),
  rec("2026-02-02", 200, "Travel", "Cash"),
  rec("2026-02-28", 1500, "Rent", "Bank"),
  rec("2026-03-01", 650.5, "Food", "UPI", { Particular: "Big Bazaar" }),
];
