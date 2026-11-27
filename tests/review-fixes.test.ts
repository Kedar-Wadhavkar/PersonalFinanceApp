/* Regression tests for the bugs found in the November 2026 code review:
   - "today" taken in UTC instead of on the device (timezone off-by-one)
   - float noise in money sums (0.1 + 0.2) turning "equal" into "overspent"
   - amounts that round to zero shown as "-₹0", "+₹0" or "−0.0%"
   - holdings table sort broken by empty values (NaN comparator)
   - Excel day numbers past 9999 giving 5-digit years
   - line chart: the month in progress not marked "(so far)" on its last day
   - share donut drawn off the half circle when refunds make a share < 0 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { excelDate } from "../src/cellValues";
import { parseMatrices } from "../src/excel";
import { monthIndex, totalsByMonth } from "../src/insights";
import { lineState, renderLineChart } from "../src/lineChart";
import { mkPct, mkSignPct, mkState, parseMarket, selectMarket, setMarketData } from "../src/market";
import { MODULES, moduleData } from "../src/modules";
import { netWorthData, setAccountsData } from "../src/networth";
import { overviewData, overviewInsights, overviewState } from "../src/overview";
import { emptySettings, setActiveCurrency, setRows } from "../src/state";
import type { SheetMatrix, Transaction } from "../src/types";
import { money, moneyShort, moneySign, roundCents, setMoneyCurrency, signedMoney, signedMoneyShort, todayIso, todayUtcMs } from "../src/utils";
import { rec } from "./helpers/records";
import { serial } from "./helpers/xlsx";

const parsed = (records: Transaction[]) => ({
  records,
  skipped: { count: 0, samples: [] },
  settings: emptySettings(),
  settingsSheetName: "",
  sheetNames: [],
});

const realTz = process.env.TZ;
// Run `fn` with the device in another time zone at the instant `utc`
function at<T>(tz: string, utc: string, fn: () => T): T {
  process.env.TZ = tz;
  vi.setSystemTime(new Date(utc));
  try {
    return fn();
  } finally {
    process.env.TZ = realTz;
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
  }
}

beforeEach(() => {
  setActiveCurrency("INR");
  setMoneyCurrency("INR");
});
afterEach(() => {
  moduleData.income = null;
  moduleData.expense = null;
  setAccountsData(null);
});

describe("today is the date on the device, not in UTC", () => {
  it("India just after midnight: already the new day", () => {
    // 1 Dec 2026, 00:30 in India is still 30 Nov in UTC
    at("Asia/Kolkata", "2026-11-30T19:00:00Z", () => {
      expect(new Date().toISOString().slice(0, 10)).toBe("2026-11-30"); // the old way
      expect(todayIso()).toBe("2026-12-01");
      expect(todayUtcMs()).toBe(Date.UTC(2026, 11, 1));
    });
  });

  it("New York in the evening: not yet tomorrow", () => {
    // 30 Nov 2026, 21:00 in New York is already 1 Dec in UTC
    at("America/New_York", "2026-12-01T02:00:00Z", () => {
      expect(todayIso()).toBe("2026-11-30");
      expect(todayUtcMs()).toBe(Date.UTC(2026, 10, 30));
    });
  });

  it("Net worth: in India on the 1st, the market counts at today's prices in the NEW month", () => {
    const grid = [
      ["Date", "Order", "Holding", "Units", "UnitAvg"],
      [serial("2026-10-05"), "Buy", "NIFTYBEES", 10, 100],
    ];
    const prices = [
      ["Holding", "LTP"],
      ["NIFTYBEES", 150],
    ];
    const market = parseMarket([
      { name: "Orders", grid },
      { name: "Prices", grid: prices },
    ])!;
    setMarketData(market);
    const months = at("Asia/Kolkata", "2026-11-30T19:00:00Z", () => netWorthData());
    const last = months[months.length - 1]!;
    // Before the fix the last month was November (UTC date) and December was missing
    expect(last.m).toBe(monthIndex("2026-12-01"));
    expect(last.market).toBe(1500); // live value
    expect(months.find((x) => x.m === monthIndex("2026-11-01"))!.market).toBe(1000); // at cost
  });
});

describe("line chart: the month in progress", () => {
  it("is drawn dashed (not over yet) on its last day too", () => {
    setRows([rec("2026-09-10", 100), rec("2026-10-12", 200), rec("2026-11-05", 300)]);
    lineState.cats = ["Food"];
    lineState.range = "Max";
    // 30 Nov, 23:00 in New York: November is not over yet
    const html = at("America/New_York", "2026-12-01T04:00:00Z", () => {
      renderLineChart();
      return document.getElementById("lineChart")!.innerHTML;
    });
    // The month in progress: dashed last segment, open last point
    expect(html).toContain('stroke-dasharray="4 3"');
    expect(html).toContain('fill="#fff"');
    // The next morning it is over
    const after = at("America/New_York", "2026-12-01T14:00:00Z", () => {
      renderLineChart();
      return document.getElementById("lineChart")!.innerHTML;
    });
    expect(after).not.toContain('stroke-dasharray="4 3"');
    setRows([]);
  });
});

describe("money rounding", () => {
  it("roundCents rounds half away from zero and never gives -0", () => {
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(-1.005)).toBe(-1.01);
    expect(Object.is(roundCents(-0.001), 0)).toBe(true);
    expect(roundCents(2.675)).toBe(2.68);
  });

  it("amounts are read to the cent (Amount + Credit)", () => {
    const sheets: SheetMatrix[] = [
      {
        name: "Expense",
        grid: [
          ["2026"],
          ["Date", "Particulars", "Amount", "Credit", "Category", "Mode"],
          [serial("2026-11-02"), "Tea", 1000.1, 0.2, "Food", "Cash"],
        ],
      },
    ];
    const r = parseMatrices(sheets, MODULES.expense).records[0]!;
    expect(r.Amount).toBe(1000.3); // was 1000.3000000000001
  });

  it("equal income and spending is not 'overspent'", () => {
    // 0.1 + 0.2 = 0.30000000000000004 earned, 0.3 spent
    const income = [rec("2026-10-01", 0.1, "Salary"), rec("2026-10-02", 0.2, "Salary")];
    const expense = [rec("2026-10-03", 0.3, "Food")];
    expect(totalsByMonth(income).get(monthIndex("2026-10-01"))).toBe(0.3);
    // and the other way round: earned 0.3, spent 0.1 + 0.2, net was -5.5e-17
    const income2 = [rec("2026-10-01", 0.3, "Salary")];
    const expense2 = [rec("2026-10-03", 0.1, "Food"), rec("2026-10-04", 0.2, "Food")];
    for (const [inc, exp] of [
      [income, expense],
      [income2, expense2],
    ] as const) {
      moduleData.income = parsed([...inc]);
      moduleData.expense = parsed([...exp]);
      overviewState.period = "month";
      overviewState.month = null;
      const d = overviewData()!;
      expect(d.months[0]!.net).toBe(0);
      overviewState.month = d.bothLast;
      expect(overviewInsights(d, [d.bothLast])).not.toContain("spent more than you earned");
    }
  });
});

describe("signs of amounts that round to zero", () => {
  it("money() never shows -₹0", () => {
    expect(money(-0.3)).toBe("₹0");
    expect(money(-1e-12)).toBe("₹0");
    expect(money(-1.4)).toBe("-₹1");
    expect(moneyShort(-0.01)).toBe("₹0");
  });

  it("signed amounts follow the amount as shown", () => {
    expect(moneySign(0.3)).toBe(0);
    expect(moneySign(-0.49)).toBe(0);
    expect(moneySign(-0.5)).toBe(-1);
    expect(signedMoney(5.5e-17)).toBe("₹0");
    expect(signedMoney(-0.3)).toBe("₹0");
    expect(signedMoney(1200)).toBe("+₹1,200");
    expect(signedMoney(-300)).toBe("−₹300");
    expect(signedMoneyShort(-0.2)).toBe("₹0");
    expect(signedMoneyShort(1500000, false)).toBe("₹15L");
  });

  it("percentages that round to zero have no sign", () => {
    expect(mkSignPct(-0.0004)).toBe("0.0%");
    expect(mkSignPct(0.0004)).toBe("0.0%");
    expect(mkSignPct(-0.012)).toBe("−1.2%");
    expect(mkPct(-0.00001)).toBe("0.0%");
  });
});

describe("Excel day numbers", () => {
  it("past 31-12-9999 are not dates", () => {
    expect(excelDate(2958465)!.toISOString().slice(0, 10)).toBe("9999-12-31");
    expect(excelDate(2958466)).toBeNull();
    expect(excelDate(25000000)).toBeNull(); // an amount typed in the Date column
  });
});

describe("holdings table sort", () => {
  it("keeps holdings without an XIRR last and the rest in order", () => {
    const names = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];
    const grid: (string | number)[][] = [["Date", "Order", "Holding", "Units", "UnitAvg"]];
    names.forEach((n) => grid.push([serial("2025-01-10"), "Buy", n, 10, 100]));
    // Only some holdings have a price (no price = no XIRR)
    const prices: (string | number)[][] = [
      ["Holding", "LTP"],
      ["BBB", 130],
      ["DDD", 110],
      ["FFF", 150],
    ];
    setMarketData(
      parseMarket([
        { name: "Orders", grid },
        { name: "Prices", grid: prices },
      ])!,
    );
    mkState.sortKey = "xirr";
    mkState.sortDir = -1;
    selectMarket();
    const order = () =>
      [...document.querySelectorAll<HTMLElement>("#mkTableCard tbody tr")].map((tr) => tr.dataset.holding);
    expect(order().slice(0, 3)).toEqual(["FFF", "BBB", "DDD"]);
    expect(order().slice(3).sort()).toEqual(["AAA", "CCC", "EEE"]);
    mkState.sortDir = 1;
    selectMarket();
    expect(order().slice(0, 3)).toEqual(["DDD", "BBB", "FFF"]);
    mkState.sortKey = "current";
    mkState.sortDir = -1;
  });
});

describe("share donuts with refunds", () => {
  it("keep the ring within the half circle when a share is above 100%", async () => {
    const { setupDonuts } = await import("../src/donuts");
    const { refreshCatalog } = await import("../src/state");
    // November: 100 of food, a refund of -50, so food is 200% of the month
    setRows([rec("2026-11-05", 100, "Food"), rec("2026-11-06", -50, "Refund")]);
    refreshCatalog();
    setupDonuts();
    const cat = document.querySelector('.donut[data-key="cats"]')!;
    const selectedPath = cat.querySelector('[data-part="selected"]')!.getAttribute("d")!;
    // The violet part ends at the right end of the ring (x 192), not back at the left (x 8)
    expect(selectedPath).toContain("A92 92 0 0 1 192.00 100.00");
    expect(cat.querySelector(".donut-share")!.textContent).toBe("200%");
    setRows([]);
  });
});
