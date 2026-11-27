import { describe, expect, it } from "vitest";
import { monthIndex } from "../src/insights";
import { accountGroup, accountKind, marketCostAt, monthEnd, netWorthMonths, parseAccounts } from "../src/networth";
import type { AccountEntry, MarketOrder, SheetMatrix } from "../src/types";
import { serial } from "./helpers/xlsx";

const m = (iso: string) => monthIndex(iso + "-01");

const entry = (date: string, account: string, balance: number, type = "Bank"): AccountEntry => ({
  date,
  account,
  type,
  kind: accountKind(type, account),
  balance,
  currency: "INR",
});

const order = (date: string, type: "Buy" | "Sell", holding: string, units: number, price: number): MarketOrder => ({
  date,
  type,
  holding,
  units,
  price,
  value: units * price,
  charges: 0,
  index: null,
  eqUnits: null,
});

describe("accountKind and accountGroup", () => {
  it("treats loans, cards and similar types as debts", () => {
    for (const t of ["Loan", "Home loan", "Card", "Credit card", "Mortgage", "Debt", "Liability"]) expect(accountKind(t)).toBe("debt");
    for (const t of ["Bank", "FD", "PPF", "Property", "Gold", "Other"]) expect(accountKind(t)).toBe("asset");
  });

  it("falls back on the account name when there is no type", () => {
    expect(accountKind("", "Car loan")).toBe("debt");
    expect(accountKind("", "HDFC savings")).toBe("asset");
  });

  it("groups bank-like assets as cash", () => {
    expect(accountGroup("Bank", "asset")).toBe("cash");
    expect(accountGroup("FD", "asset")).toBe("cash");
    expect(accountGroup("Wallet", "asset")).toBe("cash");
    expect(accountGroup("PPF", "asset")).toBe("other");
    expect(accountGroup("Property", "asset")).toBe("other");
    expect(accountGroup("Loan", "debt")).toBe("debt");
  });
});

describe("parseAccounts", () => {
  const sheet = (rows: (string | number)[][], name = "Accounts"): SheetMatrix => ({ name, grid: rows });

  it("reads the table under a year heading, with debts as amounts owed", () => {
    const d = parseAccounts([
      sheet([
        ["2026"],
        ["Date", "Account", "Type", "Balance", "Currency"],
        [serial("2026-01-31"), "HDFC", "Bank", 100000, ""],
        ["28-02-2026", "HDFC", "Bank", "1,20,000", "₹"],
        [serial("2026-01-31"), "Home loan", "Loan", 500000],
        [serial("2026-01-31"), "Credit card", "Card", -22300],
        [serial("2026-01-31"), "US account", "Bank", 900, "USD"],
        [serial("2026-01-31"), "Overdraft", "Bank", -500],
      ]),
    ])!;
    expect(d.sheetNames).toEqual(["Accounts"]);
    expect(d.skipped).toBe(0);
    expect(d.entries.map((e) => [e.date, e.account, e.kind, e.balance, e.currency])).toEqual([
      ["2026-01-31", "HDFC", "asset", 100000, "INR"],
      ["2026-01-31", "Home loan", "debt", 500000, "INR"],
      ["2026-01-31", "Credit card", "debt", 22300, "INR"],
      ["2026-01-31", "US account", "asset", 900, "USD"],
      ["2026-01-31", "Overdraft", "asset", -500, "INR"],
      ["2026-02-28", "HDFC", "asset", 120000, "INR"],
    ]);
  });

  it("counts rows without a date, account or balance as skipped", () => {
    const d = parseAccounts([
      sheet([
        ["Date", "Account", "Balance"],
        [serial("2026-01-31"), "HDFC", 10],
        [serial("2026-01-31"), "", 10],
        ["", "SBI", 10],
        [serial("2026-01-31"), "SBI", "N/A"],
        [2027],
        [],
      ]),
    ])!;
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]!.type).toBe("Other");
    expect(d.skipped).toBe(3);
  });

  it("ignores sheets without the Accounts headings", () => {
    expect(parseAccounts([sheet([["Date", "Amount", "Category", "Mode"], [serial("2026-01-01"), 5, "Food", "Cash"]], "Expense")])).toBeNull();
  });
});

describe("marketCostAt", () => {
  const orders = [order("2025-01-10", "Buy", "AAA", 10, 100), order("2025-03-05", "Buy", "AAA", 10, 200), order("2025-04-01", "Sell", "AAA", 5, 300)];

  it("adds up the cost of what is held at a date, average-cost method", () => {
    expect(marketCostAt(orders, "2024-12-31")).toBe(0);
    expect(marketCostAt(orders, "2025-01-31")).toBe(1000);
    expect(marketCostAt(orders, "2025-03-31")).toBe(3000);
    // 5 of 20 units sold at an average cost of 150
    expect(marketCostAt(orders, "2025-04-30")).toBe(2250);
  });
});

describe("monthEnd", () => {
  it("gives the last day of the month", () => {
    expect(monthEnd(m("2026-02"))).toBe("2026-02-28");
    expect(monthEnd(m("2024-02"))).toBe("2024-02-29");
    expect(monthEnd(m("2025-12"))).toBe("2025-12-31");
  });
});

describe("netWorthMonths", () => {
  const entries = [
    entry("2026-01-31", "HDFC", 100000),
    entry("2026-01-31", "PPF", 50000, "PPF"),
    entry("2026-01-31", "Home loan", 400000, "Loan"),
    entry("2026-03-31", "HDFC", 130000),
    entry("2026-03-31", "Home loan", 390000, "Loan"),
  ];

  it("carries the last balance into months without a row", () => {
    const list = netWorthMonths({ entries, today: "2026-03-31" });
    expect(list.map((x) => [x.m, x.cash, x.other, x.debt, x.net])).toEqual([
      [m("2026-01"), 100000, 50000, 400000, -250000],
      [m("2026-02"), 100000, 50000, 400000, -250000],
      [m("2026-03"), 130000, 50000, 390000, -210000],
    ]);
    expect(list[1]!.accounts.find((a) => a.account === "HDFC")!.asOf).toBe("2026-01-31");
    expect(list.every((x) => x.saved === null)).toBe(true);
  });

  it("adds the market: cost for past months, today's value for the current month", () => {
    const orders = [order("2026-02-10", "Buy", "AAA", 10, 1000)];
    const list = netWorthMonths({ entries, market: { orders, current: 12500 }, today: "2026-05-20" });
    expect(list.map((x) => [x.m, x.market, x.marketAtCost])).toEqual([
      [m("2026-01"), 0, false],
      [m("2026-02"), 10000, true],
      [m("2026-03"), 10000, true],
      [m("2026-04"), 10000, true],
      [m("2026-05"), 12500, false],
    ]);
    expect(list[4]!.net).toBe(130000 + 50000 + 12500 - 390000);
    expect(list[4]!.accounts.find((a) => a.group === "market")!.asOf).toBe("2026-05-20");
  });

  it("works with the market file alone", () => {
    const orders = [order("2026-10-01", "Buy", "AAA", 1, 100)];
    const list = netWorthMonths({ entries: [], market: { orders, current: 120 }, today: "2026-11-20" });
    expect(list.map((x) => x.net)).toEqual([100, 120]);
  });

  it("puts each month's income minus expenses beside it", () => {
    const saved = new Map([[m("2026-02"), 15000]]);
    const list = netWorthMonths({ entries, saved, today: "2026-03-31" });
    expect(list.map((x) => x.saved)).toEqual([0, 15000, 0]);
  });

  it("is empty without accounts or market", () => {
    expect(netWorthMonths({ entries: [], today: "2026-11-20" })).toEqual([]);
  });
});
