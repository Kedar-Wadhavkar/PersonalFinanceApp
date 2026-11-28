import { beforeEach, describe, expect, it } from "vitest";
import { moduleData } from "../src/modules";
import {
  overviewData,
  overviewInsights,
  overviewState,
  per100,
  periodLabel,
  periodMonths,
  sumOver,
} from "../src/overview";
import { marketSummary, mkFindHeader, mkQty, mkSignPct, mkSquarify, mkXirr, parseMarket, setMarketData } from "../src/market";
import { monthIndex } from "../src/insights";
import { emptySettings, setActiveCurrency } from "../src/state";
import type { SheetMatrix, Transaction } from "../src/types";
import { setMoneyCurrency } from "../src/utils";
import { rec } from "./helpers/records";
import { serial } from "./helpers/xlsx";

const parsed = (records: Transaction[]) => ({
  records,
  skipped: { count: 0, samples: [] },
  settings: emptySettings(),
  settingsSheetName: "",
  sheetNames: [],
});

const m = (iso: string) => monthIndex(iso + "-01");

beforeEach(() => {
  setActiveCurrency("INR");
  setMoneyCurrency("INR");
  overviewState.period = "month";
  overviewState.month = null;
});

/* =================================================================
   Overview: income vs expenses
   ================================================================= */

describe("overviewData", () => {
  beforeEach(() => {
    moduleData.income = parsed([
      rec("2026-01-01", 50000, "Salary", "Bank"),
      rec("2026-02-01", 50000, "Salary", "Bank"),
      rec("2026-02-15", 2000, "Interest", "Bank"),
      rec("2026-04-01", 52000, "Salary", "Bank"),
      rec("2026-04-02", 999, "Salary", "Bank", { Currency: "USD" }),
    ]);
    moduleData.expense = parsed([
      rec("2026-01-05", 30000, "Rent"),
      rec("2026-02-05", 60000, "Travel"),
      rec("2026-03-05", 20000, "Rent"),
      rec("2026-05-05", 10000, "Rent"),
    ]);
  });

  it("joins income and expenses per month, filling gaps with zero", () => {
    const d = overviewData()!;
    expect(d.months.map((x) => [x.inc, x.exp, x.net])).toEqual([
      [50000, 30000, 20000],
      [52000, 60000, -8000],
      [0, 20000, -20000],
      [52000, 0, 52000],
      [0, 10000, -10000],
    ]);
    expect(d.first).toBe(m("2026-01"));
    expect(d.last).toBe(m("2026-05"));
  });

  it("only counts the chosen currency", () => {
    setActiveCurrency("USD");
    const d = overviewData()!;
    expect(d.months.map((x) => x.inc)).toEqual([999]);
    expect(d.expense).toEqual([]);
  });

  it("defaults to the latest month both sheets reached", () => {
    // Income goes to April, expenses to May: April is the last month with both
    expect(overviewData()!.bothLast).toBe(m("2026-04"));
  });

  it("returns null with no records in this currency", () => {
    setActiveCurrency("EUR");
    expect(overviewData()).toBeNull();
  });

  it("picks the months of the period and labels it", () => {
    const d = overviewData()!;
    overviewState.month = m("2026-02");
    expect(periodMonths(d)).toEqual([m("2026-02")]);
    expect(periodLabel(periodMonths(d))).toBe("Feb 2026");
    overviewState.period = "year";
    expect(periodMonths(d)).toEqual([m("2026-01"), m("2026-02"), m("2026-03"), m("2026-04"), m("2026-05")]);
    expect(periodLabel(periodMonths(d))).toBe("2026 (Jan–May)");
    expect(sumOver(d.incM, periodMonths(d))).toBe(154000);
    expect(sumOver(d.expM, periodMonths(d))).toBe(120000);
  });

  it("splits every 100 earned", () => {
    expect(per100(25000, 50000)).toBe("₹50");
    expect(per100(100, 50000)).toBe("<₹1");
    expect(per100(0, 50000)).toBe("₹0");
    expect(per100(10, 0)).toBe("–");
  });

  it("writes insights about overspending and income growth", () => {
    const d = overviewData()!;
    overviewState.month = m("2026-04");
    const text = overviewInsights(d, [m("2026-04")]).replace(/<[^>]+>/g, " ");
    expect(text).toContain("Overspent");
    expect(text).toContain("Feb 2026 is the only month in the last 4 where you spent more than you earned");
    expect(text).toContain("No income");
    expect(text).toContain("Mar 26");
  });

  it("notes a category that rose well above its 3-month average", () => {
    moduleData.income = parsed(["01", "02", "03", "04"].map((mm) => rec(`2026-${mm}-01`, 1000, "Salary")));
    moduleData.expense = parsed([
      rec("2026-01-02", 100, "Food"),
      rec("2026-02-02", 100, "Food"),
      rec("2026-03-02", 100, "Food"),
      rec("2026-04-02", 300, "Food"),
    ]);
    const d = overviewData()!;
    const text = overviewInsights(d, [m("2026-04")]);
    expect(text).toContain("Food was ₹300 in Apr 2026, 200% above its 3-month average of ₹100.");
    expect(text).toContain("On track");
  });
});

/* =================================================================
   Market
   ================================================================= */

const ORDERS_HEAD = ["Date", "Order", "Holding", "Units", "UnitAvg", "LotValue", "Charges", "IndexValue", "EqCumUnits"];
const sheet = (name: string, grid: unknown[][]): SheetMatrix => ({ name, grid: grid as SheetMatrix["grid"] });

describe("parseMarket", () => {
  it("finds the tables by their headings and reads orders and prices", () => {
    const data = parseMarket([
      sheet("Expense", [["Date", "Amount", "Category", "Mode"]]),
      sheet("Log", [
        ["My trades"],
        ORDERS_HEAD,
        [serial("2025-02-01"), "Buy", " NIFTYBEES ", 10, 250, 2500, 5, 22000, 0.11],
        ["01-01-2025", "B", "GOLDBEES", 5, 60, null, null],
        ["15-03-2025", "Sell", "NIFTYBEES", 4, 260, 1040, 2],
        ["16-03-2025", "Buy", "NIFTYBEES", -2, 270, null, null], // negative units = a sell
        [null, null, null, null, null],
        ["", "Buy", "BAD", "x", 1], // no date, unreadable units
        ["17-03-2025", "Buy", "", 1, 1], // no holding
      ]),
      sheet("Sheet2", [
        ["Holding", "LTP", "Category", "Sector", "SubSector", "Qty", "Avg"],
        ["NIFTYBEES", 280, "ETF", "Index", "Large cap"],
        ["GIFT", 100, "Stock", "", "", 3, 50],
        [12345, 1], // total row
      ]),
    ])!;
    expect(data.sheetNames).toEqual(["Log", "Sheet2"]);
    expect(data.orders.map((o) => [o.date, o.type, o.holding, o.units, o.value])).toEqual([
      ["2025-01-01", "Buy", "GOLDBEES", 5, 300],
      ["2025-02-01", "Buy", "NIFTYBEES", 10, 2500],
      ["2025-03-15", "Sell", "NIFTYBEES", 4, 1040],
      ["2025-03-16", "Sell", "NIFTYBEES", 2, 540],
    ]);
    expect(data.skipped).toBe(2);
    expect(data.info.get("NIFTYBEES")).toMatchObject({ ltp: 280, category: "ETF", subSector: "Large cap" });
    expect(data.info.has("12345")).toBe(false);
  });

  it("reads the instrument type from an Instrument heading (and still from Category)", () => {
    const orders = sheet("Orders", [ORDERS_HEAD, ["01-01-2025", "Buy", "NIFTYBEES", 1, 100]]);
    const withInstrument = parseMarket([orders, sheet("P", [["Holding", "LTP", "Instrument"], ["NIFTYBEES", 110, "ETF"]])])!;
    const withCategory = parseMarket([orders, sheet("P", [["Holding", "LTP", "Category"], ["NIFTYBEES", 110, "ETF"]])])!;
    expect(withInstrument.info.get("NIFTYBEES")?.category).toBe("ETF");
    expect(withCategory.info.get("NIFTYBEES")?.category).toBe("ETF");
  });

  it("reads the held units from a Units heading (and still from Qty)", () => {
    const orders = sheet("Orders", [ORDERS_HEAD, ["01-01-2025", "Buy", "NIFTYBEES", 1, 100]]);
    const withUnits = parseMarket([orders, sheet("P", [["Holding", "LTP", "Units", "Avg"], ["GIFT", 100, 3, 50]])])!;
    const withQty = parseMarket([orders, sheet("P", [["Holding", "LTP", "Qty", "Avg"], ["GIFT", 100, 3, 50]])])!;
    expect(withUnits.info.get("GIFT")?.qty).toBe(3);
    expect(withQty.info.get("GIFT")?.qty).toBe(3);
  });

  it("reads the instrument type from an Instrument heading (and still from Category)", () => {
    const orders = sheet("Orders", [ORDERS_HEAD, ["01-01-2025", "Buy", "NIFTYBEES", 1, 100]]);
    const withInstrument = parseMarket([orders, sheet("P", [["Holding", "LTP", "Instrument"], ["NIFTYBEES", 110, "ETF"]])])!;
    const withCategory = parseMarket([orders, sheet("P", [["Holding", "LTP", "Category"], ["NIFTYBEES", 110, "ETF"]])])!;
    expect(withInstrument.info.get("NIFTYBEES")?.category).toBe("ETF");
    expect(withCategory.info.get("NIFTYBEES")?.category).toBe("ETF");
  });

  it("returns null without an orders table", () => {
    expect(parseMarket([sheet("Sheet2", [["Holding", "LTP"], ["A", 1]])])).toBeNull();
  });

  it("accepts Price instead of UnitAvg and headings in any case", () => {
    const h = mkFindHeader([["DATE", "order", "Holding", "units", "Price"]], ["date", "order", "holding", "units", "unitavg|price"]);
    expect(h).toEqual({ row: 0, cols: { date: 0, order: 1, holding: 2, units: 3, price: 4 } });
  });
});

describe("marketSummary", () => {
  const load = (orders: unknown[][], prices: unknown[][] = []) => {
    const data = parseMarket([sheet("Orders", [ORDERS_HEAD, ...orders]), sheet("P", [["Holding", "LTP", "Category"], ...prices])])!;
    setMarketData(data);
    return marketSummary();
  };

  it("works out quantity, average cost and profit with the average-cost method", () => {
    const s = load(
      [
        ["01-01-2025", "Buy", "AAA", 10, 100, 1000, 10],
        ["01-02-2025", "Buy", "AAA", 10, 120, 1200, 10],
        ["01-03-2025", "Sell", "AAA", 5, 150, 750, 5],
      ],
      [["AAA", 130, "Stock"]],
    );
    const h = s.held[0]!;
    expect(h.qty).toBe(15);
    expect(h.avg).toBeCloseTo(110, 9);
    expect(h.invested).toBeCloseTo(1650, 9);
    expect(h.current).toBe(1950);
    expect(h.pnl).toBeCloseTo(300, 9);
    expect(h.pct).toBeCloseTo(300 / 1650, 9);
    expect(h.realised).toBeCloseTo(750 - 550, 9);
    expect(h.charges).toBe(25);
    expect(h.share).toBe(1);
    expect(s).toMatchObject({ invested: h.invested, current: 1950, charges: 25 });
    expect(s.realised).toBeCloseTo(200, 9);
  });

  it("does not count units sold beyond what was held as profit", () => {
    const s = load([
      ["01-01-2025", "Buy", "AAA", 10, 100, 1000],
      ["01-02-2025", "Sell", "AAA", 15, 120, 1800], // 5 more than held
    ]);
    expect(s.realised).toBeCloseTo(10 * 120 - 1000, 9);
    expect(s.held).toHaveLength(0);
    expect(s.all[0]!.qty).toBe(0);
  });

  it("ignores a sell that comes before any buy", () => {
    const s = load([
      ["01-01-2025", "Sell", "AAA", 3, 100, 300],
      ["02-01-2025", "Buy", "AAA", 2, 100, 200],
    ]);
    expect(s.realised).toBe(0);
    expect(s.held[0]!.qty).toBe(2);
  });

  it("values a holding without a price at cost and lists it", () => {
    const s = load([["01-01-2025", "Buy", "NOPRICE", 2, 50, 100]]);
    expect(s.held[0]!.current).toBe(100);
    expect(s.held[0]!.xirr).toBeNull();
    expect(s.noPrice.map((h) => h.name)).toEqual(["NOPRICE"]);
  });

  it("counts units held for more than a year, oldest sold first", () => {
    // Today is 20 Nov 2026 (see setup)
    const s = load(
      [
        ["01-01-2025", "Buy", "AAA", 10, 100, 1000],
        ["01-10-2026", "Buy", "AAA", 10, 100, 1000],
        ["01-11-2026", "Sell", "AAA", 4, 100, 400],
      ],
      [["AAA", 100]],
    );
    expect(s.held[0]!.ltQty).toBe(6);
  });

  it("compares with the same money put into the index", () => {
    const s = load([
      ["01-01-2025", "Buy", "AAA", 10, 100, 1000, 0, 20000, 0.05],
      ["01-02-2025", "Buy", "AAA", 10, 100, 1000, 0, 25000, 0.09],
    ]);
    expect(s.bench).toEqual({ value: 0.09 * 25000, index: 25000, date: "2025-02-01" });
  });
});

describe("XIRR", () => {
  it("finds the yearly return of dated cash flows", () => {
    expect(mkXirr([{ d: "2025-01-01", v: -1000 }, { d: "2026-01-01", v: 1100 }])).toBeCloseTo(0.1, 4);
    expect(mkXirr([{ d: "2025-01-01", v: -1000 }, { d: "2026-01-01", v: 800 }])).toBeCloseTo(-0.2, 4);
    // Two years of 10%: 1000 -> 1210
    expect(mkXirr([{ d: "2024-01-01", v: -1000 }, { d: "2025-12-31", v: 1210 }])).toBeCloseTo(0.1, 2);
  });

  it("needs money in and money out", () => {
    expect(mkXirr([{ d: "2025-01-01", v: -1000 }])).toBeNull();
    expect(mkXirr([{ d: "2025-01-01", v: -1000 }, { d: "2026-01-01", v: -5 }])).toBeNull();
  });
});

describe("market formatting and treemap", () => {
  it("formats quantities and signed percentages", () => {
    expect(mkQty(10)).toBe("10");
    expect(mkQty(2.5)).toBe("2.500");
    expect(mkQty(3.0000001)).toBe("3");
    expect(mkSignPct(0.123)).toBe("+12.3%");
    expect(mkSignPct(-0.05)).toBe("−5.0%");
    expect(mkSignPct(0)).toBe("0.0%");
    expect(mkSignPct(null)).toBe("–");
  });

  it("lays out boxes whose areas match their values and fill the space", () => {
    const rects = mkSquarify([{ value: 6 }, { value: 3 }, { value: 1 }, { value: 0 }], 0, 0, 100, 50);
    expect(rects).toHaveLength(3);
    const area = rects.reduce((s, r) => s + r.w * r.h, 0);
    expect(area).toBeCloseTo(5000, 6);
    for (const r of rects) {
      expect((r.w * r.h) / 5000).toBeCloseTo(r.value / 10, 6);
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(100 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(50 + 1e-6);
    }
    expect(mkSquarify([], 0, 0, 10, 10)).toEqual([]);
  });
});
