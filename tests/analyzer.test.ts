/* The rules of analyzer.ts: merchant matching, interval and amount checks,
   recurring bills, the yearly cost, and anomalies. */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPTIONS,
  addMonths,
  amountsConsistent,
  analyzeTransactions,
  annualRecurringCost,
  dayNumber,
  detectAnomalies,
  detectFrequency,
  detectRecurring,
  groupByMerchant,
  isoFromDay,
  levenshtein,
  median,
  nameSimilarity,
  normalizeMerchant,
} from "../src/analyzer";
import type { Transaction } from "../src/types";
import { rec } from "./helpers/records";

/** n monthly payments starting on `start`, same day of the month. */
function monthly(name: string, start: string, n: number, amount: number | ((i: number) => number), category = "Bills"): Transaction[] {
  return Array.from({ length: n }, (_, i) =>
    rec(addMonths(start, i), typeof amount === "function" ? amount(i) : amount, category, "Card", { Particular: name }),
  );
}

describe("date helpers", () => {
  it("turns ISO dates into day numbers and back", () => {
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(dayNumber("2026-03-01") - dayNumber("2026-02-01")).toBe(28);
    expect(isoFromDay(dayNumber("2026-11-27"))).toBe("2026-11-27");
  });

  it("adds months, keeping the day where the month allows", () => {
    expect(addMonths("2026-01-15", 1)).toBe("2026-02-15");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-11-10", 3)).toBe("2027-02-10");
    expect(addMonths("2026-12-05", 12)).toBe("2027-12-05");
    expect(addMonths("2026-01-05", -1)).toBe("2025-12-05");
  });

  it("finds the median", () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("merchant names", () => {
  it("keeps only the words that name the merchant", () => {
    expect(normalizeMerchant("NETFLIX.COM Subscription - Nov 2026 #4471")).toBe("netflix");
    expect(normalizeMerchant("Rent Jan")).toBe("rent");
    expect(normalizeMerchant("Airtel postpaid bill payment 9876543210")).toBe("airtel postpaid");
    expect(normalizeMerchant("UPI/Spotify India/REF123")).toBe("spotify india");
    expect(normalizeMerchant("Électricité – EDF")).toBe("électricité edf");
  });

  it("gives an empty name when nothing is left", () => {
    expect(normalizeMerchant("")).toBe("");
    expect(normalizeMerchant("12/03/2026 #99")).toBe("");
    expect(normalizeMerchant("Monthly payment")).toBe("");
  });

  it("measures edit distance", () => {
    expect(levenshtein("netflix", "netflix")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("netflix", "netflx")).toBe(1);
  });

  it("scores similar names", () => {
    expect(nameSimilarity("netflix", "netflix")).toBe(1);
    expect(nameSimilarity("amazon prime", "amazon prime video")).toBe(1);
    expect(nameSimilarity("netflix", "netflx")).toBeCloseTo(6 / 7);
    expect(nameSimilarity("netflix", "spotify")).toBeLessThan(0.5);
    expect(nameSimilarity("", "netflix")).toBe(0);
    // A very short name is not a prefix match ("gas" vs "gas station")
    expect(nameSimilarity("gas", "gas station")).toBeLessThan(DEFAULT_OPTIONS.nameSimilarity);
  });

  it("groups payments by merchant, merging spelling variants", () => {
    const list = [
      rec("2026-01-05", 649, "Fun", "Card", { Particular: "Netflix" }),
      rec("2026-02-05", 649, "Fun", "Card", { Particular: "NETFLIX.COM" }),
      rec("2026-03-05", 649, "Fun", "Card", { Particular: "Netflx subscription" }),
      rec("2026-03-06", 119, "Fun", "Card", { Particular: "Spotify" }),
      rec("2026-03-07", 100, "Fun", "Card", { Particular: "#123" }), // no name
      rec("2026-03-08", -649, "Fun", "Card", { Particular: "Netflix refund" }), // refund
      rec("2026-03-09", 649, "Fun", "Card", { Particular: "Netflix", Currency: "USD" }), // other currency
    ];
    const groups = groupByMerchant(list);
    const sizes = Object.fromEntries(groups.map((g) => [`${g.currency} ${g.key}`, g.records.length]));
    expect(sizes).toEqual({ "INR netflix": 3, "INR spotify": 1, "USD netflix": 1 });
    // Oldest first inside a group
    expect(groups[0]!.records.map((r) => r.Date)).toEqual(["2026-01-05", "2026-02-05", "2026-03-05"]);
  });
});

describe("interval and amount checks", () => {
  it("recognises monthly payments, even on slightly different days", () => {
    expect(detectFrequency(["2026-01-01", "2026-02-03", "2026-03-01", "2026-03-30"])).toEqual({ frequency: "monthly", intervalDays: 29 });
  });

  it("allows a missed month inside a monthly series", () => {
    const dates = ["2026-01-05", "2026-02-05", "2026-04-05", "2026-05-05", "2026-06-05"];
    expect(detectFrequency(dates)?.frequency).toBe("monthly");
  });

  it("recognises yearly payments from two of them", () => {
    expect(detectFrequency(["2025-03-10", "2026-03-12"])).toEqual({ frequency: "annual", intervalDays: 367 });
  });

  it("needs enough payments", () => {
    expect(detectFrequency(["2026-01-05", "2026-02-05"])).toBeNull(); // 2 monthly payments
    expect(detectFrequency(["2026-01-05"])).toBeNull();
    expect(detectFrequency(["2026-01-05", "2026-02-05"], { minMonthlyCount: 2 })?.frequency).toBe("monthly");
  });

  it("counts several entries on one day once", () => {
    expect(detectFrequency(["2026-01-05", "2026-01-05", "2026-01-05"])).toBeNull();
  });

  it("rejects weekly, irregular and mostly-off intervals", () => {
    expect(detectFrequency(["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22"])).toBeNull();
    expect(detectFrequency(["2026-01-01", "2026-01-20", "2026-03-15", "2026-04-02", "2026-06-30"])).toBeNull();
    // Median gap is monthly but too many gaps are not
    expect(detectFrequency(["2026-01-01", "2026-01-31", "2026-03-02", "2026-03-12", "2026-03-22", "2026-04-21"])).toBeNull();
    // Quarterly is neither monthly nor yearly
    expect(detectFrequency(["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"])).toBeNull();
  });

  it("checks that amounts stay close to the median", () => {
    expect(amountsConsistent([499, 499, 499])).toBe(true);
    expect(amountsConsistent([1800, 2100, 2400, 1950, 2200])).toBe(true); // a utility bill
    expect(amountsConsistent([100, 900, 300, 2000])).toBe(false);
    expect(amountsConsistent([0, 0, 0])).toBe(false);
    expect(amountsConsistent([100, 100, 100, 100, 500])).toBe(true); // 80% close is enough
    expect(amountsConsistent([100, 100, 100, 500, 500])).toBe(false);
  });
});

describe("recurring bills", () => {
  const data = [
    ...monthly("Netflix Subscription", "2026-01-12", 11, 649, "Entertainment"),
    ...monthly("Electricity bill - MSEB", "2026-01-03", 11, (i) => 1800 + (i % 3) * 200, "Utilities"),
    ...monthly("Rent Jan", "2026-01-01", 11, 20000, "Rent"),
    rec("2025-03-02", 1499, "Shopping", "Card", { Particular: "Amazon Prime annual" }),
    rec("2026-03-04", 1499, "Shopping", "Card", { Particular: "AMAZON PRIME" }),
    // A gym that stopped in April
    ...monthly("Gold's Gym", "2026-01-20", 4, 1500, "Health"),
    // Groceries: often, never at a steady interval or amount
    rec("2026-01-04", 1200, "Food", "UPI", { Particular: "Big Bazaar" }),
    rec("2026-01-09", 300, "Food", "UPI", { Particular: "Big Bazaar" }),
    rec("2026-02-21", 2500, "Food", "UPI", { Particular: "Big Bazaar" }),
    rec("2026-03-01", 800, "Food", "UPI", { Particular: "Big Bazaar" }),
    // Steady interval, wildly different amounts: not a bill
    ...monthly("Croma", "2026-01-15", 4, (i) => [500, 25000, 1200, 9000][i]!, "Shopping"),
  ];
  const found = detectRecurring(data);
  const byKey = Object.fromEntries(found.map((r) => [r.key, r]));

  it("finds the monthly and yearly bills, and nothing else", () => {
    expect(Object.keys(byKey).sort()).toEqual(["amazon prime", "electricity mseb", "gold s gym", "netflix", "rent"]);
  });

  it("describes a monthly subscription", () => {
    expect(byKey.netflix).toMatchObject({
      name: "Netflix Subscription",
      category: "Entertainment",
      currency: "INR",
      frequency: "monthly",
      count: 11,
      typicalAmount: 649,
      lastAmount: 649,
      firstDate: "2026-01-12",
      lastDate: "2026-11-12",
      nextDate: "2026-12-12",
      annualCost: 649 * 12,
      active: true,
    });
    expect(byKey.netflix!.records).toHaveLength(11);
  });

  it("uses the median of a bill that varies", () => {
    expect(byKey["electricity mseb"]!.typicalAmount).toBe(2000);
    expect(byKey["electricity mseb"]!.annualCost).toBe(24000);
  });

  it("describes a yearly subscription with differently written names", () => {
    expect(byKey["amazon prime"]).toMatchObject({ frequency: "annual", count: 2, annualCost: 1499, nextDate: "2027-03-04", name: "AMAZON PRIME" });
  });

  it("marks a series that stopped as not active", () => {
    expect(byKey["gold s gym"]!.active).toBe(false);
    expect(byKey["gold s gym"]!.lastDate).toBe("2026-04-20");
  });

  it("sorts active bills first, the largest yearly cost first", () => {
    expect(found.map((r) => r.key)).toEqual(["rent", "electricity mseb", "netflix", "amazon prime", "gold s gym"]);
  });

  it("adds up the yearly cost of the active bills only", () => {
    expect(annualRecurringCost(found)).toBe(240000 + 24000 + 7788 + 1499);
  });

  it("measures 'still active' from a given day", () => {
    const later = detectRecurring(data, { today: "2027-06-01" });
    expect(later.find((r) => r.key === "netflix")!.active).toBe(false);
    expect(later.find((r) => r.key === "amazon prime")!.active).toBe(true);
  });

  it("finds nothing in an empty list", () => {
    expect(detectRecurring([])).toEqual([]);
  });

  it("keeps currencies apart", () => {
    const mixed = [
      ...monthly("Spotify", "2026-01-01", 2, 119),
      ...monthly("Spotify", "2026-03-01", 1, 9.99).map((r) => ({ ...r, Currency: "USD" })),
    ];
    expect(detectRecurring(mixed)).toEqual([]);
  });
});

describe("anomalies", () => {
  const food = Array.from({ length: 10 }, (_, i) => rec(`2026-01-${String(i + 1).padStart(2, "0")}`, 400 + (i % 5) * 50, "Food"));

  it("flags an entry far above its category average", () => {
    const big = rec("2026-01-20", 4000, "Food", "Card", { Particular: "Wedding catering" });
    const [a, ...rest] = detectAnomalies([...food, big]);
    expect(rest).toEqual([]);
    expect(a!.record).toBe(big);
    expect(a!.category).toBe("Food");
    expect(a!.categoryAverage).toBe(500);
    expect(a!.ratio).toBe(8);
    expect(a!.zScore).toBeGreaterThan(10);
    expect(a!.severity).toBe("high");
  });

  it("calls a smaller outlier medium", () => {
    const [a] = detectAnomalies([...food, rec("2026-01-20", 1200, "Food")]);
    expect(a!.ratio).toBeCloseTo(2.4);
    expect(a!.severity).toBe("medium");
  });

  it("does not flag normal entries, or high ones in a category that always varies", () => {
    expect(detectAnomalies(food)).toEqual([]);
    const travel = [200, 5000, 300, 8000, 150, 6000, 400].map((v, i) => rec(`2026-02-0${i + 1}`, v, "Travel"));
    expect(detectAnomalies([...travel, rec("2026-02-20", 9000, "Travel")])).toEqual([]);
  });

  it("needs enough other entries in the category", () => {
    const few = food.slice(0, 4);
    expect(detectAnomalies([...few, rec("2026-01-20", 4000, "Food")])).toEqual([]);
    expect(detectAnomalies([...few, rec("2026-01-20", 4000, "Food")], { minCategorySize: 4 })).toHaveLength(1);
  });

  it("flags by ratio alone when every other entry is the same", () => {
    const rent = Array.from({ length: 6 }, (_, i) => rec(`2026-0${i + 1}-01`, 20000, "Rent"));
    const [a] = detectAnomalies([...rent, rec("2026-07-01", 45000, "Rent")]);
    expect(a!.zScore).toBe(Number.POSITIVE_INFINITY);
    expect(a!.ratio).toBe(2.25);
    expect(detectAnomalies([...rent, rec("2026-07-01", 21000, "Rent")])).toEqual([]);
  });

  it("compares within the same currency and ignores refunds", () => {
    const usd = rec("2026-01-20", 4000, "Food", "Card", { Currency: "USD" });
    const refund = rec("2026-01-21", -5000, "Food");
    expect(detectAnomalies([...food, usd, refund])).toEqual([]);
  });

  it("sorts the most unusual first and follows the options", () => {
    const fuel = food.map((r) => ({ ...r, Category: "Fuel", Amount: r.Amount * 2 }));
    const list = [
      ...food,
      ...fuel,
      rec("2026-01-20", 1500, "Food", "Card", { Particular: "A" }), // 3× the Food average
      rec("2026-01-21", 5000, "Fuel", "Card", { Particular: "B" }), // 5× the Fuel average
    ];
    expect(detectAnomalies(list).map((a) => a.record.Particular)).toEqual(["B", "A"]);
    expect(detectAnomalies(list, { anomalyRatio: 4 }).map((a) => a.record.Particular)).toEqual(["B"]);
  });
});

describe("analyzeTransactions", () => {
  it("returns recurring bills, anomalies and the yearly cost together", () => {
    const list = [
      ...monthly("Spotify", "2026-01-07", 6, 119, "Entertainment"),
      ...Array.from({ length: 8 }, (_, i) => rec(`2026-03-0${i + 1}`, 300, "Food")),
      rec("2026-03-20", 2400, "Food", "Card", { Particular: "Party" }),
    ];
    const result = analyzeTransactions(list);
    expect(result.recurring.map((r) => r.key)).toEqual(["spotify"]);
    expect(result.anomalies.map((a) => a.record.Particular)).toEqual(["Party"]);
    expect(result.annualCost).toBe(119 * 12);
  });
});
