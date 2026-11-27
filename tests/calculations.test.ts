import { beforeEach, describe, expect, it } from "vitest";
import { computeKpis, computeView, KPI_SETS, monthPairs, sortPairs, topEntry } from "../src/dashboard";
import { donutDefaults, topOf, totalsBy } from "../src/donuts";
import { sortedByTotal } from "../src/filterGroup";
import { applyBarFilter, buildFilters, current, dashFilters, dashboardMatcher } from "../src/filters";
import { heatLevel, heatLimits } from "../src/heatmap";
import { changeText, monthIndex, monthName, totalsByMonth } from "../src/insights";
import { axisCandidates, lineWindow, niceMax, thinLabels } from "../src/lineChart";
import { catalog, kpiData, refreshCatalog, rows, setRows, tableRows, txSort, upperSort, view } from "../src/state";
import { sortTableRows } from "../src/table";
import { $, esc, money, moneyShort, setMoneyCurrency, smoothPath, tint } from "../src/utils";
import { rec, SPENDING } from "./helpers/records";

const search = () => $<HTMLInputElement>("search");

// Load a set of records the way the app does after reading a workbook
function load(list = SPENDING) {
  setRows(list);
  refreshCatalog();
  sortTableRows();
  buildFilters();
  search().value = "";
}

beforeEach(() => {
  setMoneyCurrency("INR");
  txSort.col = "Date";
  txSort.dir = "desc";
  load();
});

/* =================================================================
   Totals and categories
   ================================================================= */

describe("catalog", () => {
  it("lists years newest first and categories / modes A-Z, once each", () => {
    expect(catalog.years).toEqual(["2026", "2025"]);
    expect(catalog.dateYears).toEqual(["2026", "2025"]);
    expect(catalog.categories).toEqual(["Food", "Gifts", "Rent", "Travel"]);
    expect(catalog.modes).toEqual(["Bank", "Card", "Cash", "UPI"]);
  });

  it("is empty with no records", () => {
    load([]);
    expect(catalog).toEqual({ years: [], categories: [], modes: [], dateYears: [] });
  });
});

describe("dashboard totals (computeView)", () => {
  it("adds up every record when nothing is filtered", () => {
    computeView();
    expect(view.records).toHaveLength(9);
    expect(view.sum).toBeCloseTo(10350.5, 6);
    expect(Object.fromEntries(view.groups.Category)).toEqual({ Food: 2650.5, Rent: 4500, Gifts: 3000, Travel: 200 });
    expect(Object.fromEntries(view.groups.Year)).toEqual({ "2025": 5700, "2026": 4650.5 });
    expect(Object.fromEntries(view.groups.Mode)).toEqual({ Cash: 700, Bank: 4500, UPI: 2150.5, Card: 3000 });
    expect(view.groups.Month.get("Nov")).toBe(2000);
    expect(view.groups.Month.get("Jan")).toBe(2300);
  });

  it("totals always match the sum of the records shown", () => {
    applyBarFilter("Category", "Food");
    computeView();
    const sum = view.records.reduce((s, r) => s + r.Amount, 0);
    expect(view.sum).toBeCloseTo(sum, 9);
    for (const totals of Object.values(view.groups)) {
      expect([...totals.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(sum, 9);
    }
  });

  it("filters by year, month, category and mode together", () => {
    applyBarFilter("Year", "2026");
    applyBarFilter("Category", "Rent");
    computeView();
    expect(view.records.map((r) => r.Date)).toEqual(["2026-02-28", "2026-01-15"]);
    expect(view.sum).toBe(3000);

    applyBarFilter("Month", "Feb");
    computeView();
    expect(view.records.map((r) => r.Date)).toEqual(["2026-02-28"]);
  });

  it("shows nothing when a menu has nothing ticked", () => {
    dashFilters.cats.setValues([]);
    expect(dashboardMatcher()).toBeNull();
    computeView();
    expect(view.records).toEqual([]);
    expect(view.sum).toBe(0);
  });

  it("searches every field, ignoring case and outer spaces", () => {
    search().value = "  big BAZAAR ";
    computeView();
    expect(view.records.map((r) => r.Particular)).toEqual(["Big Bazaar"]);
    search().value = "upi";
    expect(current().length).toBe(3);
    search().value = "650.5";
    expect(current().length).toBe(1);
  });

  it("handles refunds (negative amounts) in the totals", () => {
    load([rec("2026-01-01", 1000, "Shopping"), rec("2026-01-05", -250, "Shopping")]);
    computeView();
    expect(view.sum).toBe(750);
    expect(view.groups.Category.get("Shopping")).toBe(750);
  });

  it("keeps decimal amounts exact enough for money", () => {
    load(Array.from({ length: 10 }, (_, i) => rec(`2026-01-${String(i + 1).padStart(2, "0")}`, 0.1)));
    computeView();
    expect(money(view.sum)).toBe("₹1");
    expect(view.sum).toBeCloseTo(1, 9);
  });
});

describe("filter menus", () => {
  it("lists categories with spending in the ticked years, biggest first", () => {
    expect(dashFilters.items.cats).toEqual(["Rent", "Gifts", "Food", "Travel"]);
    applyBarFilter("Year", "2026");
    expect(dashFilters.items.cats).toEqual(["Rent", "Food", "Travel"]);
  });

  it("lists modes with spending in the ticked categories", () => {
    applyBarFilter("Category", "Food");
    expect(dashFilters.items.modes).toEqual(["UPI", "Cash"]);
  });

  it("remembers a category choice when the years change, as far as it exists", () => {
    dashFilters.cats.setValues(["Gifts", "Travel"]);
    dashFilters.cats.set(); // the user's tick
    // Simulate the user's change through the menu's checkbox
    const box = document.querySelector<HTMLInputElement>("#dashCatMenu input.dashCatCheck[value='Travel']")!;
    box.checked = true;
    box.onchange!(new Event("change"));
    applyBarFilter("Year", "2026"); // Gifts has no 2026 spending
    expect(dashFilters.cats.values()).toEqual(["Travel"]);
  });

  it("ranks ties by name", () => {
    expect(sortedByTotal(new Map([["b", 5], ["a", 5], ["c", 9]]))).toEqual(["c", "a", "b"]);
  });
});

describe("transactions table order", () => {
  it("sorts by date, amount and text, keeping file order for equal values", () => {
    expect(tableRows[0]!.Date).toBe("2026-03-01");
    txSort.col = "Amount";
    txSort.dir = "desc";
    sortTableRows();
    expect(tableRows.slice(0, 4).map((r) => r.Amount)).toEqual([3000, 1500, 1500, 1500]);
    expect(tableRows.slice(1, 4).map((r) => r.Date)).toEqual(["2025-11-20", "2026-01-15", "2026-02-28"]);
    txSort.col = "Category";
    txSort.dir = "asc";
    sortTableRows();
    expect(tableRows[0]!.Category).toBe("Food");
    expect(tableRows[tableRows.length - 1]!.Category).toBe("Travel");
  });

  it("sorts text without regard to case or accents", () => {
    load([rec("2026-01-01", 1, "b"), rec("2026-01-02", 1, "A"), rec("2026-01-03", 1, "á")]);
    txSort.col = "Category";
    txSort.dir = "asc";
    sortTableRows();
    expect(tableRows.map((r) => r.Category)).toEqual(["A", "á", "b"]);
  });
});

describe("bar list sorting", () => {
  it("sorts by amount, name or time in either direction", () => {
    const data: [string, number][] = [["2024", 5], ["2026", 1], ["2025", 9]];
    upperSort.year = { by: "time", dir: "desc" };
    expect(sortPairs(data, "year").map((d) => d[0])).toEqual(["2026", "2025", "2024"]);
    upperSort.year = { by: "amount", dir: "asc" };
    expect(sortPairs(data, "year").map((d) => d[0])).toEqual(["2026", "2024", "2025"]);
    upperSort.category = { by: "name", dir: "desc" };
    expect(sortPairs([["a", 1], ["c", 1], ["b", 1]], "category").map((d) => d[0])).toEqual(["c", "b", "a"]);
    upperSort.year = { by: "time", dir: "desc" };
    upperSort.category = { by: "amount", dir: "desc" };
  });

  it("shows months in calendar order, hiding months without spending", () => {
    computeView();
    upperSort.month = { by: "time", dir: "asc" };
    expect(monthPairs().map((m) => m[0])).toEqual(["Jan", "Feb", "Mar", "Nov", "Dec"]);
    upperSort.month = { by: "amount", dir: "desc" };
    expect(monthPairs()[0]).toEqual(["Dec", 3700]);
    upperSort.month = { by: "time", dir: "asc" };
  });
});

/* =================================================================
   KPI cards
   ================================================================= */

describe("KPI cards (computeKpis)", () => {
  it("works out the overall figures from all records, ignoring filters", () => {
    applyBarFilter("Category", "Travel");
    computeKpis();
    expect(kpiData.sum).toBeCloseTo(10350.5, 6);
    expect(kpiData.monthCount).toBe(5); // Nov, Dec 2025, Jan, Feb, Mar 2026
    const [total, average, top, count] = KPI_SETS.overall();
    expect(total).toEqual(["Total expense", "₹10,351"]);
    expect(average).toEqual(["Average monthly expense", money(10350.5 / 5)]);
    expect(top).toEqual(["Top category · Rent", "₹4,500"]);
    expect(count).toEqual(["Categories", 4]);
  });

  it('uses the latest month in the data as "current", not today', () => {
    computeKpis();
    expect(kpiData.current).toMatchObject({ year: "2026", month: "Mar", yearSum: 4650.5, monthSum: 650.5 });
    const [yearTotal, monthTotal, top] = KPI_SETS.current();
    expect(yearTotal).toEqual(["2026 total expense", "₹4,651"]);
    expect(monthTotal).toEqual(["Mar 2026 expense", "₹651"]);
    expect(top).toEqual(["2026 top category · Rent", "₹3,000"]);
  });

  it("counts the latest calendar month even when its row sits under last year's heading", () => {
    // A January bill entered in the 2025 table: Year (heading) 2025, date 2026
    load([rec("2025-12-10", 100), rec("2026-01-03", 40, "Food", "Cash", { Year: "2025" })]);
    computeKpis();
    expect(kpiData.current.month).toBe("Jan");
    expect(kpiData.current.monthSum).toBe(40);
  });

  it("shows zeros, not errors, with no records", () => {
    load([]);
    computeKpis();
    expect(KPI_SETS.overall()).toEqual([
      ["Total expense", "₹0"],
      ["Average monthly expense", "₹0"],
      ["Top category", "₹0"],
      ["Categories", 0],
    ]);
  });

  it("picks the biggest entry of a set of totals", () => {
    expect(topEntry(new Map([["a", 1], ["b", 3], ["c", 2]]))).toEqual(["b", 3]);
    expect(topEntry(new Map())).toEqual(["", 0]);
    expect(topOf(new Map([["x", -5], ["y", -1]]))).toBe("y");
  });
});

/* =================================================================
   Dates and months
   ================================================================= */

describe("month helpers", () => {
  it("numbers months so that neighbours differ by one, across years", () => {
    expect(monthIndex("2026-01-15") - monthIndex("2025-12-31")).toBe(1);
    expect(monthName(monthIndex("2026-03-01"))).toBe("Mar 2026");
    expect(monthName(monthIndex("2025-12-31"))).toBe("Dec 2025");
  });

  it("totals records per calendar month", () => {
    const totals = totalsByMonth(SPENDING);
    expect(totals.get(monthIndex("2025-12-01"))).toBe(3700);
    expect(totals.get(monthIndex("2026-02-01"))).toBe(1700);
    expect([...totals.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(10350.5, 6);
  });

  it("describes a change between two months", () => {
    expect(changeText(118, 100, "Sep 2026")).toBe("▲ 18% more than Sep 2026");
    expect(changeText(93, 100, "Sep 2026")).toBe("▼ 7% less than Sep 2026");
    expect(changeText(100, 100, "Sep 2026")).toBe("Same as Sep 2026");
    expect(changeText(100, 0, "Sep 2026")).toBe("");
    expect(changeText(100, undefined, "Sep 2026")).toBe("");
    expect(changeText(50, -100, "Sep")).toBe("▲ 150% more than Sep");
  });
});

describe("spending trend time frames (lineWindow)", () => {
  const t = (iso: string) => Date.parse(iso + "T00:00:00Z");

  it("Max covers whole months from the first to the last date", () => {
    const w = lineWindow("Max", t("2025-11-03"), t("2026-03-01"));
    expect(w.mode).toBe("month");
    expect(w.count).toBe(5);
    expect(new Date(w.t0).toISOString().slice(0, 10)).toBe("2025-11-01");
    expect(new Date(w.t1).toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(w.indexOf(t("2025-11-30"))).toBe(0);
    expect(w.indexOf(t("2026-03-01"))).toBe(4);
    expect(w.clipped).toBe(false);
  });

  it("YTD starts in January of the last date's year", () => {
    const w = lineWindow("YTD", t("2020-01-01"), t("2026-03-15"));
    expect(w.count).toBe(3);
    expect(new Date(w.bucketStart(0)).toISOString().slice(0, 7)).toBe("2026-01");
  });

  it("1Y is the last 12 months, and says when the data is shorter", () => {
    expect(lineWindow("1Y", t("2020-01-01"), t("2026-03-15")).count).toBe(12);
    const short = lineWindow("1Y", t("2025-11-03"), t("2026-03-01"));
    expect(short.count).toBe(5);
    expect(short.clipped).toBe(true);
  });

  it("3M uses whole weeks ending on the last date", () => {
    const w = lineWindow("3M", t("2020-01-01"), t("2026-03-31"));
    expect(w.mode).toBe("week");
    expect(w.count).toBe(13);
    expect(w.t1).toBe(t("2026-04-01"));
    expect(w.indexOf(t("2026-03-31"))).toBe(12);
    expect(w.bucketEnd(w.count - 1)).toBe(w.t1);
  });

  it("puts every record of the period into exactly one bucket", () => {
    const w = lineWindow("Max", t("2025-11-03"), t("2026-03-01"));
    const sums = new Array<number>(w.count).fill(0);
    for (const r of SPENDING) sums[w.indexOf(t(r.Date))]! += r.Amount;
    expect(sums).toEqual([2000, 3700, 2300, 1700, 650.5]);
  });

  it("chooses round scale tops close to the highest value", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
    expect(niceMax(3700)).toBe(4000);
    expect(niceMax(1000)).toBe(1000);
    expect(niceMax(1001)).toBe(1200);
    expect(niceMax(0.07)).toBeCloseTo(0.08, 9);
  });

  it("labels the axis with months or years and drops labels that would touch", () => {
    const months = axisCandidates(t("2025-11-01"), t("2026-03-01"), false).map((c) => c.text);
    expect(months).toEqual(["Nov 2025", "Dec", "Jan 2026", "Feb"]);
    const years = axisCandidates(t("2024-06-01"), t("2026-03-01"), true).map((c) => c.text);
    expect(years).toEqual(["2024", "2025", "2026"]);
    const labels = [0, 10, 20, 30, 40].map((x) => ({ x, w: 12 }));
    expect(thinLabels(labels).map((l) => l.x)).toEqual([0, 20, 40]);
  });
});

describe("calendar colours", () => {
  it("splits spending days into five similar-sized levels", () => {
    const limits = heatLimits([10, 20, 30, 40, 50, 60, 70, 80, 90, 1000]);
    expect(limits).toEqual([20, 40, 60, 80, 1000]);
    expect(heatLevel(10, limits)).toBe(0);
    expect(heatLevel(45, limits)).toBe(2);
    expect(heatLevel(1000, limits)).toBe(4);
    expect(heatLevel(5000, limits)).toBe(4);
  });
});

describe("Share of Expenditure starting choice", () => {
  it("starts on the latest month with spending, then its top category and mode", () => {
    // Today is 20 Nov 2026 (see setup): walks back to March 2026
    expect(donutDefaults()).toEqual({ years: ["2026"], months: ["Mar"], cats: ["Food"], modes: ["UPI"] });
  });

  it("uses this month when it has spending", () => {
    load([...SPENDING, rec("2026-11-02", 90, "Fuel", "Card"), rec("2026-11-05", 10, "Fuel", "Cash")]);
    expect(donutDefaults()).toEqual({ years: ["2026"], months: ["Nov"], cats: ["Fuel"], modes: ["Card"] });
  });

  it("adds up by any field", () => {
    expect(Object.fromEntries(totalsBy("Mode", (r) => r.Category === "Food"))).toEqual({ Cash: 500, UPI: 2150.5 });
    expect(rows).toHaveLength(9);
  });
});

/* =================================================================
   Formatting
   ================================================================= */

describe("money formatting", () => {
  it("uses Indian digit grouping and the selected currency", () => {
    expect(money(1234567)).toBe("₹12,34,567");
    expect(money(-500)).toBe("-₹500");
    expect(money(0.4)).toBe("₹0");
    expect(money(null)).toBe("₹0");
    expect(money(Number.NaN)).toBe("₹0");
    expect(moneyShort(1698859)).toBe("₹17L");
    setMoneyCurrency("USD");
    expect(money(1234567)).toBe("$12,34,567");
    setMoneyCurrency("XYZ1"); // not a real currency code: plain number
    expect(money(42)).toBe("42");
  });

  it("makes cell text safe for the page", () => {
    expect(esc(`<img src=x onerror="alert('x')">&`)).toBe("&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;");
    expect(esc(5)).toBe("5");
  });

  it("draws smooth curves that never overshoot the points", () => {
    expect(smoothPath([[0, 0]])).toBe("");
    expect(smoothPath([[0, 0], [10, 5]])).toBe("M0.0 0.0 L10.0 5.0");
    const d = smoothPath([[0, 100], [10, 0], [20, 0], [30, 100]]);
    const ys = [...d.matchAll(/(-?\d+\.\d) (-?\d+\.\d)/g)].map((m) => Number(m[2]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });

  it("lightens colours towards white", () => {
    expect(tint("#000000", 0)).toBe("rgb(0,0,0)");
    expect(tint("#000000", 1)).toBe("rgb(255,255,255)");
    expect(tint("#2563eb", 0.5)).toBe("rgb(146,177,245)");
  });
});
