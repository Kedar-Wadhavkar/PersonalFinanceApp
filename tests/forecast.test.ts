import { describe, expect, it } from "vitest";
import {
  defaultReturn,
  historicalAverages,
  isDiscretionary,
  monthlyRate,
  project,
  simProjections,
  type History,
  type Scenario,
  type StartPoint,
} from "../src/forecast";
import { monthIndex } from "../src/insights";
import type { MarketOrder } from "../src/types";
import { rec } from "./helpers/records";

const ZERO: StartPoint = { cash: 0, invested: 0, other: 0, debt: 0 };
const base: Scenario = {
  income: 100000,
  expense: 60000,
  discretionary: 20000,
  cut: 0,
  monthlyInvest: 0,
  annualReturn: 0,
  incomeGrowth: 0,
  months: 12,
};

const order = (date: string, type: "Buy" | "Sell", value: number): MarketOrder => ({
  date,
  type,
  holding: "AAA",
  units: 1,
  price: value,
  value,
  charges: 0,
  index: null,
  eqUnits: null,
});

describe("monthlyRate", () => {
  it("compounds back to the yearly rate", () => {
    expect(Math.pow(1 + monthlyRate(0.1), 12)).toBeCloseTo(1.1, 12);
    expect(monthlyRate(0)).toBe(0);
  });
});

describe("project", () => {
  it("adds the monthly surplus to cash when nothing is invested", () => {
    const p = project({ cash: 50000, invested: 0, other: 200000, debt: 100000 }, base);
    expect(p).toHaveLength(13);
    expect(p[0]!.net).toBe(150000);
    expect(p[12]!.cash).toBe(50000 + 12 * 40000);
    expect(p[12]!.savedTotal).toBe(480000);
    // Other assets and debts stay as they are
    expect(p[12]!.net).toBe(50000 + 480000 + 200000 - 100000);
  });

  it("cuts only the discretionary part of spending", () => {
    const p = project(ZERO, { ...base, cut: 0.25 });
    // 60,000 − 25% of 20,000 = 55,000 spent; 45,000 saved a month
    expect(p[1]!.savedTotal).toBe(45000);
    expect(p[12]!.net).toBe(12 * 45000);
  });

  it("moves the monthly investment out of cash and compounds it", () => {
    const p = project(ZERO, { ...base, monthlyInvest: 10000, annualReturn: 0.12 });
    const r = monthlyRate(0.12);
    let inv = 0;
    for (let k = 0; k < 12; k++) inv = inv * (1 + r) + 10000;
    expect(p[12]!.invested).toBeCloseTo(inv, 6);
    expect(p[12]!.cash).toBe(12 * 30000);
    expect(p[12]!.contributed).toBe(120000);
    expect(p[12]!.growth).toBeCloseTo(inv - 120000, 6);
    expect(p[12]!.net).toBeCloseTo(p[12]!.cash + p[12]!.invested, 6);
  });

  it("grows existing investments at the expected return", () => {
    const p = project({ ...ZERO, invested: 100000 }, { ...base, income: 0, expense: 0, discretionary: 0, annualReturn: 0.1 });
    expect(p[12]!.invested).toBeCloseTo(110000, 6);
    expect(p[12]!.growth).toBeCloseTo(10000, 6);
  });

  it("raises income once every 12 months", () => {
    const p = project(ZERO, { ...base, months: 25, incomeGrowth: 0.1 });
    const surplus = (k: number) => p[k]!.savedTotal - p[k - 1]!.savedTotal;
    expect(surplus(1)).toBe(40000);
    expect(surplus(12)).toBe(40000);
    expect(surplus(13)).toBeCloseTo(110000 - 60000, 6);
    expect(surplus(25)).toBeCloseTo(121000 - 60000, 6);
  });

  it("lets cash go below zero when more is invested than saved", () => {
    const p = project(ZERO, { ...base, monthlyInvest: 50000 });
    expect(p[1]!.cash).toBe(-10000);
  });

  it("never spends less than nothing", () => {
    const p = project(ZERO, { ...base, expense: 1000, discretionary: 5000, cut: 1 });
    expect(p[1]!.savedTotal).toBe(100000);
  });
});

describe("historicalAverages", () => {
  const income = [rec("2026-01-01", 100000, "Salary"), rec("2026-02-01", 100000, "Salary"), rec("2026-03-01", 130000, "Salary"), rec("2026-04-01", 999, "Salary")];
  const expense = [rec("2026-01-05", 40000, "Rent"), rec("2026-01-09", 20000, "Shopping"), rec("2026-03-05", 40000, "Rent"), rec("2026-03-20", 10000, "Travel")];

  it("averages up to the latest month both sheets reach, gaps as 0", () => {
    const h = historicalAverages(income, expense, new Set(["Shopping", "Travel"]))!;
    expect(h.months).toEqual([monthIndex("2026-01-01"), monthIndex("2026-02-01"), monthIndex("2026-03-01")]);
    expect(h.income).toBeCloseTo(110000, 6);
    expect(h.expense).toBeCloseTo(110000 / 3, 6);
    expect(h.discretionary).toBe(10000);
    expect(h.saved).toBeCloseTo(110000 - 110000 / 3, 6);
    expect(h.savingsRate).toBeCloseTo(2 / 3, 6);
    expect(h.invested).toBe(0);
  });

  it("looks back only the given number of months", () => {
    const h = historicalAverages(income, expense, new Set(), [], 2)!;
    expect(h.months).toHaveLength(2);
    expect(h.income).toBe(115000);
    expect(h.expense).toBe(25000);
  });

  it("counts money put into the market, net of sells", () => {
    const orders = [order("2025-12-01", "Buy", 99999), order("2026-01-10", "Buy", 30000), order("2026-02-10", "Buy", 15000), order("2026-03-10", "Sell", 9000)];
    expect(historicalAverages(income, expense, new Set(), orders)!.invested).toBe(12000);
  });

  it("needs both sheets", () => {
    expect(historicalAverages(income, [], new Set())).toBeNull();
    expect(historicalAverages([], expense, new Set())).toBeNull();
  });
});

describe("simProjections", () => {
  const h: History = { months: [1], income: 100000, expense: 60000, discretionary: 20000, saved: 40000, savingsRate: 0.4, invested: 5000 };

  it("keeps investing the historical amount on the current path and adds the extra on top", () => {
    const { baseline, scenario, scenarioInput } = simProjections(h, ZERO, { cut: 20, extra: 10000, ret: 0, growth: 0, years: 1 });
    expect(baseline[12]!.contributed).toBe(60000);
    expect(scenario[12]!.contributed).toBe(180000);
    expect(scenarioInput.cut).toBe(0.2);
    // 4,000 a month less spent
    expect(scenario[12]!.savedTotal - baseline[12]!.savedTotal).toBe(48000);
  });

  it("projects the chosen number of years", () => {
    expect(simProjections(h, ZERO, { cut: 0, extra: 0, ret: 8, growth: 0, years: 20 }).scenario).toHaveLength(241);
  });
});

describe("defaults", () => {
  it("uses the market XIRR as the expected return, within 0–15%", () => {
    expect(defaultReturn(null)).toBe(8);
    expect(defaultReturn(0.1234)).toBe(12.5);
    expect(defaultReturn(0.4)).toBe(15);
    expect(defaultReturn(-0.2)).toBe(0);
  });

  it("guesses which categories are discretionary", () => {
    for (const c of ["Shopping", "Travel", "Entertainment", "Dining out", "Gifts", "Subscriptions"]) expect(isDiscretionary(c)).toBe(true);
    for (const c of ["Rent", "Bills", "Groceries", "Health", "EMI", "Insurance"]) expect(isDiscretionary(c)).toBe(false);
  });
});
