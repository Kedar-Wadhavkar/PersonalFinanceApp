import { monthIndex, monthName } from "./insights";
import type { MarketOrder, Transaction } from "./types";
import { esc, money, moneyShort } from "./utils";

/* =========================================================================
forecast.ts
The "What if" simulator on the Net worth page.

1. History: averages of the last 12 months that the Income and Expense
   sheets cover (months without records count as 0): income, expenses, the
   part of expenses in "discretionary" categories, money saved, savings
   rate, and money put into the market each month (market file orders).
2. Sliders: cut discretionary spending, extra monthly investment, expected
   yearly return, yearly income growth; a period of 1 to 20 years.
3. Projection, month by month from today's net worth:
     surplus     = income − (expenses − discretionary × cut)
     investments = investments × (1 + monthly return) + monthly investment
     cash        = cash + surplus − monthly investment
   Other assets (property, PPF ...) and debts stay as they are; income
   rises once a year by the growth rate. "Your current path" is the same
   projection with no cut and no extra investment.
The math is plain functions (tested in tests/forecast.test.ts); the
drawing at the bottom only formats their results.
========================================================================= */

/* ------------ History ------------ */

// Categories counted as discretionary until the person changes the choice
const DISCRETIONARY =
  /shop|travel|trip|holiday|vacation|entertain|movie|dining|dine|eat.?out|restaurant|takeaway|swiggy|zomato|party|gift|leisure|hobby|fun|personal|subscript|ott|gadget|cloth|apparel|fashion|beauty|luxury|misc/i;

export function isDiscretionary(category: string): boolean {
  return DISCRETIONARY.test(category);
}

export interface History {
  /** Month indexes the averages cover, oldest first */
  months: number[];
  income: number;
  expense: number;
  /** Part of `expense` in discretionary categories */
  discretionary: number;
  saved: number;
  /** saved ÷ income, null without income */
  savingsRate: number | null;
  /** Bought − sold in the market per month (0 without a market file) */
  invested: number;
}

/**
 * Monthly averages of the last `lookback` months up to the latest month both
 * sheets reach. `discretionary` = the categories counted as discretionary.
 */
export function historicalAverages(
  income: Transaction[],
  expense: Transaction[],
  discretionary: Set<string>,
  orders: MarketOrder[] = [],
  lookback = 12,
): History | null {
  if (!income.length || !expense.length) return null;
  const lastOf = (list: Transaction[]) => Math.max(...list.map((r) => monthIndex(r.Date)));
  const firstOf = (list: Transaction[]) => Math.min(...list.map((r) => monthIndex(r.Date)));
  const last = Math.min(lastOf(income), lastOf(expense));
  const first = Math.max(Math.min(firstOf(income), firstOf(expense)), last - lookback + 1);
  if (last < first) return null;
  const months: number[] = [];
  for (let m = first; m <= last; m++) months.push(m);
  const inRange = (iso: string) => {
    const m = monthIndex(iso);
    return m >= first && m <= last;
  };
  const n = months.length;
  const sum = (list: Transaction[], keep: (r: Transaction) => boolean = () => true) =>
    list.filter((r) => inRange(r.Date) && keep(r)).reduce((s, r) => s + r.Amount, 0);
  const inc = sum(income) / n;
  const exp = sum(expense) / n;
  const disc = sum(expense, (r) => discretionary.has(r.Category)) / n;
  const flows = orders.filter((o) => inRange(o.date)).reduce((s, o) => s + (o.type === "Buy" ? o.value : -o.value), 0);
  return {
    months,
    income: inc,
    expense: exp,
    discretionary: disc,
    saved: inc - exp,
    savingsRate: inc > 0 ? (inc - exp) / inc : null,
    invested: Math.max(0, flows / n),
  };
}

/* ------------ Projection ------------ */

export interface StartPoint {
  cash: number;
  invested: number;
  other: number;
  debt: number;
}

export interface Scenario {
  /** Monthly averages the projection starts from */
  income: number;
  expense: number;
  discretionary: number;
  /** Share of discretionary spending cut, 0–1 */
  cut: number;
  /** Put into investments every month (out of the surplus) */
  monthlyInvest: number;
  /** Expected yearly return of investments, e.g. 0.1 */
  annualReturn: number;
  /** Yearly income growth, applied once every 12 months, e.g. 0.05 */
  incomeGrowth: number;
  months: number;
}

export interface ProjectionPoint {
  /** Months from today, 0 = today */
  k: number;
  cash: number;
  invested: number;
  net: number;
  /** Income − expenses added up since today (no returns) */
  savedTotal: number;
  /** Money put into investments since today */
  contributed: number;
  /** Returns earned since today */
  growth: number;
}

/** Monthly rate that compounds to the yearly one: (1 + r)^(1/12) − 1. */
export const monthlyRate = (annual: number): number => Math.pow(1 + annual, 1 / 12) - 1;

export function project(start: StartPoint, s: Scenario): ProjectionPoint[] {
  const r = monthlyRate(s.annualReturn);
  let cash = start.cash;
  let invested = start.invested;
  let savedTotal = 0;
  let contributed = 0;
  let growth = 0;
  const net = () => cash + invested + start.other - start.debt;
  const out: ProjectionPoint[] = [{ k: 0, cash, invested, net: net(), savedTotal, contributed, growth }];
  const spend = Math.max(0, s.expense - s.discretionary * s.cut);
  for (let k = 1; k <= s.months; k++) {
    const income = s.income * Math.pow(1 + s.incomeGrowth, Math.floor((k - 1) / 12));
    const surplus = income - spend;
    const earned = invested * r;
    invested += earned + s.monthlyInvest;
    cash += surplus - s.monthlyInvest;
    savedTotal += surplus;
    contributed += s.monthlyInvest;
    growth += earned;
    out.push({ k, cash, invested, net: net(), savedTotal, contributed, growth });
  }
  return out;
}

/* ------------ Simulator state and drawing ------------ */

export const PERIODS = [1, 3, 5, 10, 20];

export const simState: {
  cut: number; // percent, 0–50
  extra: number; // extra monthly investment
  ret: number | null; // percent; null = default from history
  growth: number; // percent
  years: number;
  view: "net" | "saved";
  discretionary: Set<string> | null; // null = default categories
} = { cut: 0, extra: 0, ret: null, growth: 0, years: 5, view: "net", discretionary: null };

/** Reset what depends on the loaded data (a new workbook). */
export function resetSimulator(): void {
  simState.discretionary = null;
  simState.ret = null;
}

export interface SimInput {
  income: Transaction[];
  expense: Transaction[];
  orders: MarketOrder[];
  start: StartPoint;
  /** Today's net worth comes from data (accounts or market), not zero */
  hasStart: boolean;
  /** Yearly return of the market file, for the default return */
  xirr: number | null;
}

export function simCategories(expense: Transaction[]): string[] {
  const totals = new Map<string, number>();
  for (const r of expense) totals.set(r.Category, (totals.get(r.Category) || 0) + r.Amount);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

export function discretionarySet(categories: string[]): Set<string> {
  if (!simState.discretionary) simState.discretionary = new Set(categories.filter(isDiscretionary));
  return simState.discretionary;
}

/** Default expected return: the market file's XIRR within 0–15%, else 8%. */
export function defaultReturn(xirr: number | null): number {
  if (xirr === null || !Number.isFinite(xirr)) return 8;
  return Math.round(Math.min(15, Math.max(0, xirr * 100)) * 2) / 2;
}

/** The two projections the block shows: current path and the scenario. */
export function simProjections(h: History, start: StartPoint, opts: { cut: number; extra: number; ret: number; growth: number; years: number }) {
  const base: Scenario = {
    income: h.income,
    expense: h.expense,
    discretionary: h.discretionary,
    cut: 0,
    monthlyInvest: h.invested,
    annualReturn: opts.ret / 100,
    incomeGrowth: opts.growth / 100,
    months: opts.years * 12,
  };
  const scenario: Scenario = { ...base, cut: opts.cut / 100, monthlyInvest: h.invested + opts.extra };
  return { baseline: project(start, base), scenario: project(start, scenario), scenarioInput: scenario };
}

const pctText = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const signed = (v: number) => `${v < 0 ? "−" : "+"}${money(Math.abs(v))}`;

function sliderMax(h: History): number {
  const top = Math.max(h.income * 0.5, 5000);
  const step = top > 100000 ? 5000 : 1000;
  return Math.ceil(top / step) * step;
}

/** The whole block: inputs, then #nwSimOut (redrawn on every change). */
export function simHtml(input: SimInput): string {
  const cats = simCategories(input.expense);
  const disc = discretionarySet(cats);
  const h = historicalAverages(input.income, input.expense, disc, input.orders);
  const head = `<div class="graphtitle"><b>What if: forecast</b></div>`;
  if (!h) {
    return `${head}<div class="small">The simulator works from your history: load a workbook with both an Income and an Expense sheet.</div>`;
  }
  if (simState.ret === null) simState.ret = defaultReturn(input.xirr);
  const max = sliderMax(h);
  simState.extra = Math.min(simState.extra, max);
  const range = (id: string, label: string, value: number, min: number, maxV: number, step: number, hint: string) => `
      <div class="sim-field">
        <div class="sim-label"><label for="${id}">${esc(label)}</label><output id="${id}Out" for="${id}"></output></div>
        <input type="range" id="${id}" min="${min}" max="${maxV}" step="${step}" value="${value}">
        <span class="small">${esc(hint)}</span>
      </div>`;
  const first = h.months[0]!;
  const last = h.months[h.months.length - 1]!;
  const histCards = [
    ["Income", money(h.income), "a month"],
    ["Expenses", money(h.expense), `${money(h.discretionary)} discretionary`],
    ["Saved", money(h.saved), `Savings rate ${pctText(h.savingsRate)}`],
    ["Invested", money(h.invested), input.orders.length ? "a month, market file" : "no market file"],
  ];
  return `
    <div class="ov-head">
      <div>${head}<div class="small">Monthly averages of ${esc(monthName(first))} to ${esc(monthName(last))} (${h.months.length} month${h.months.length === 1 ? "" : "s"}), projected from ${input.hasStart ? "today's net worth" : "zero, as there are no accounts or market file"}. A forecast, not a promise.</div></div>
      <div class="ov-period" id="simPeriod" role="group" aria-label="Forecast period">
        ${PERIODS.map((y) => `<button type="button" data-years="${y}" class="${y === simState.years ? "on" : ""}" aria-pressed="${y === simState.years}">${y}y</button>`).join("")}
      </div>
    </div>
    <div class="sim-hist">${histCards.map(([l, v, s]) => `<div class="sim-stat"><span class="small">${esc(l!)}</span><b>${esc(v!)}</b><span class="small">${esc(s!)}</span></div>`).join("")}</div>
    <div class="sim-grid">
      <div class="sim-inputs">
        ${range("simCut", "Cut discretionary spending", simState.cut, 0, 50, 5, `Of ${money(h.discretionary)} a month in the categories below`)}
        ${range("simExtra", "Extra monthly investment", simState.extra, 0, max, max > 100000 ? 5000 : 1000, "Moved from savings into investments")}
        ${range("simRet", "Expected yearly return", simState.ret, 0, 20, 0.5, input.xirr !== null ? `Your market XIRR is ${pctText(input.xirr)}` : "On investments; cash earns nothing")}
        ${range("simGrowth", "Income growth per year", simState.growth, 0, 15, 1, "Applied once a year")}
        <div class="sim-field">
          <span class="sim-label"><span>Discretionary categories</span></span>
          <div class="sim-chips" id="simChips">${cats
            .map((c) => `<button type="button" class="sim-chip" data-cat="${esc(c)}" aria-pressed="${disc.has(c)}">${esc(c)}</button>`)
            .join("")}</div>
          <span class="small">Tap to choose which spending can be cut.</span>
        </div>
      </div>
      <div class="sim-out" id="nwSimOut" aria-live="polite"></div>
    </div>`;
}

/** Results for the current inputs: cards and the projection chart. */
export function simOutputHtml(input: SimInput): string {
  const cats = simCategories(input.expense);
  const disc = discretionarySet(cats);
  const h = historicalAverages(input.income, input.expense, disc, input.orders);
  if (!h) return "";
  const { baseline, scenario, scenarioInput } = simProjections(h, input.start, {
    cut: simState.cut,
    extra: simState.extra,
    ret: simState.ret ?? defaultReturn(input.xirr),
    growth: simState.growth,
    years: simState.years,
  });
  const end = scenario[scenario.length - 1]!;
  const baseEnd = baseline[baseline.length - 1]!;
  const key: "net" | "savedTotal" = simState.view === "net" ? "net" : "savedTotal";
  const spend = Math.max(0, scenarioInput.expense - scenarioInput.discretionary * scenarioInput.cut);
  const surplus = scenarioInput.income - spend;
  const rate = scenarioInput.income > 0 ? surplus / scenarioInput.income : null;
  const lowCash = scenario.find((p) => p.cash < 0 && p.k > 0);
  const label = `${simState.years} year${simState.years === 1 ? "" : "s"}`;

  const cards = [
    { l: `Net worth in ${label}`, v: money(end.net), s: `${signed(end.net - baseEnd.net)} vs your current path`, c: end.net >= baseEnd.net ? "ov-pos" : "ov-neg" },
    { l: "Saved a month", v: money(surplus), s: `Savings rate ${pctText(rate)} (now ${pctText(h.savingsRate)})`, c: surplus < 0 ? "ov-neg" : "" },
    { l: "Returns earned", v: money(end.growth), s: `On ${money(input.start.invested + end.contributed)} invested`, c: "" },
    { l: "Cash at the end", v: money(end.cash), s: lowCash ? `Runs below zero in ${Math.ceil(lowCash.k / 12)} yr: investing more than you save` : "Savings not invested", c: end.cash < 0 ? "ov-neg" : "" },
  ];

  /* ---- Chart: two lines over the period ---- */
  const W = 600;
  const H = 220;
  const values = [...baseline.map((p) => p[key]), ...scenario.map((p) => p[key])];
  // Scale to the values (not from zero), so the two paths can be told apart
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const pad = Math.max((vMax - vMin) * 0.06, Math.abs(vMax) * 0.01, 1);
  const lo = vMin - pad;
  const hi = vMax + pad;
  const x = (k: number) => (k / (scenario.length - 1)) * W;
  const y = (v: number) => H - 8 - ((v - lo) / (hi - lo || 1)) * (H - 16);
  const line = (list: ProjectionPoint[]) => list.map((p) => `${x(p.k).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const zeroY = y(0).toFixed(1);
  const zeroLine = lo < 0 && hi > 0 ? `<line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" stroke="#cbd5e1" vector-effect="non-scaling-stroke"></line>` : "";
  const ticks = Array.from({ length: Math.min(simState.years, 10) + 1 }, (_, i) => Math.round((i * simState.years) / Math.min(simState.years, 10)));
  const now = new Date();
  const yearLabel = (yrs: number) => (yrs === 0 ? "Today" : String(now.getUTCFullYear() + yrs));
  const what = simState.view === "net" ? "Net worth" : "Money saved";

  return `
    <div class="sim-cards">${cards.map((c) => `<div class="sim-stat"><span class="small">${esc(c.l)}</span><b class="${c.c}">${esc(c.v)}</b><span class="small">${esc(c.s)}</span></div>`).join("")}</div>
    <div class="sim-charthead">
      <div class="ov-period" id="simView" role="group" aria-label="Chart shows">
        <button type="button" data-view="net" class="${simState.view === "net" ? "on" : ""}" aria-pressed="${simState.view === "net"}">Net worth</button>
        <button type="button" data-view="saved" class="${simState.view === "saved" ? "on" : ""}" aria-pressed="${simState.view === "saved"}">Savings</button>
      </div>
      <div class="ov-key"><span><span class="ov-sw" style="background:#0f766e"></span>With your changes</span><span><span class="ov-sw sim-sw-base"></span>Current path</span></div>
    </div>
    <div class="sim-chart">
      <div class="sim-yaxis small" aria-hidden="true"><span>${esc(moneyShort(hi))}</span><span>${esc(moneyShort(lo))}</span></div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(`${what} over ${label}: ${money(end[key])} with your changes, ${money(baseEnd[key])} on your current path`)}">
        ${zeroLine}
        <polygon points="0,${H} ${line(scenario)} ${W},${H}" fill="#ccfbf1" opacity="0.7"></polygon>
        <polyline points="${line(baseline)}" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"></polyline>
        <polyline points="${line(scenario)}" fill="none" stroke="#0f766e" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"></polyline>
      </svg>
    </div>
    <div class="sim-xaxis small" aria-hidden="true">${ticks.map((t) => `<span>${esc(yearLabel(t))}</span>`).join("")}</div>
    <div class="sim-table-wrap"><table class="mk-table sim-table">
      <thead><tr><th>In</th><th class="num">${esc(what)}, your changes</th><th class="num">Current path</th><th class="num">Difference</th></tr></thead>
      <tbody>${[1, 3, 5, 10, 20]
        .filter((yy) => yy <= simState.years)
        .map((yy) => {
          const a = scenario[yy * 12]![key];
          const b = baseline[yy * 12]![key];
          return `<tr><td>${yy} yr (${yearLabel(yy)})</td><td class="num">${esc(money(a))}</td><td class="num">${esc(money(b))}</td><td class="num ${a - b >= 0 ? "ov-pos" : "ov-neg"}">${esc(signed(a - b))}</td></tr>`;
        })
        .join("")}</tbody>
    </table></div>
    <div class="small sim-note">Other assets (property, PPF, gold) and debts are kept at today's value; cash earns no interest; figures are not adjusted for inflation.</div>`;
}

/** Text shown next to each slider. */
export function simOutputs(): Record<string, string> {
  return {
    simCut: `${simState.cut}%`,
    simExtra: money(simState.extra),
    simRet: `${simState.ret ?? 0}%`,
    simGrowth: `${simState.growth}%`,
  };
}
