import { CONFIG } from "./config";
import { monthIndex, monthName, totalsByMonth } from "./insights";
import { MODULE_KEYS, activeModule, moduleData } from "./modules";
import type { ModuleKey, MonthSummary, OverviewData, Transaction } from "./types";
import { currencySymbol } from "./settings";
import { activeCurrency, setActiveCurrency } from "./state";
import { $, esc, money, moneyShort, setMoneyCurrency } from "./utils";

/* =========================================================================
overview.ts
The Overview page: income and expenses combined (#overviewPage).

Reads BOTH modules (moduleData.income / moduleData.expense), in the currency
chosen in the side bar, and joins them on the calendar month of each record.
  - Month / Year switch ..... the period of the cards and the income split
  - Four cards .............. Income, Expenses, Net saved, Savings rate
  - Monthly chart ........... income vs expenses, net under each month;
                              a click picks that month
  - Cumulative savings ...... running total of net saved, all months
  - Where income went ....... every 100 earned split by expense category
  - Expense cover ........... months the net saved would last
  - Insights ................ worked out from the two sheets
========================================================================= */

// "page" shown: a module key ("expense", "income") or "overview"
type PageKey = ModuleKey | "overview" | "market";
export let activePage: PageKey = "expense";

export const overviewState: { period: "month" | "year"; month: number | null } = {
  period: "month", // "month" | "year"
  month: null, // selected month index (year*12 + month-1)
};

// Month helpers (monthIndex / monthName are in insights.ts)
export const shortMonth = (i: number): string => `${CONFIG.months[i % 12]} ${String(Math.floor(i / 12)).slice(2)}`;
const pctText = (v: number): string => `${Math.round(v)}%`;
const signedShort = (v: number): string => `${v < 0 ? "−" : "+"}${moneyShort(Math.abs(v))}`;

// Records of one module in the chosen currency
export function overviewRecords(key: ModuleKey): Transaction[] {
  return (moduleData[key]?.records || []).filter((r) => r.Currency === activeCurrency);
}

// Everything the page needs, worked out once per draw
export function overviewData(): OverviewData | null {
  const income = overviewRecords("income");
  const expense = overviewRecords("expense");
  const incM = totalsByMonth(income);
  const expM = totalsByMonth(expense);
  const all = [...new Set([...incM.keys(), ...expM.keys()])].sort((a, b) => a - b);
  if (!all.length) return null;
  const first = all[0]!;
  const last = all[all.length - 1]!;
  // Every month from the first to the last, gaps included (as 0)
  const months: MonthSummary[] = [];
  for (let m = first; m <= last; m++) {
    const inc = incM.get(m) || 0;
    const exp = expM.get(m) || 0;
    months.push({ m, inc, exp, net: inc - exp });
  }
  // Latest month BOTH sheets reached = default selection
  const lastOf = (map: Map<number, number>) => (map.size ? Math.max(...map.keys()) : -1);
  const bothLast = Math.min(lastOf(incM), lastOf(expM));
  return { income, expense, incM, expM, months, first, last, bothLast: bothLast >= first ? bothLast : last };
}

// Months of the current period
export function periodMonths(d: OverviewData): number[] {
  const sel = overviewState.month!;
  if (overviewState.period === "month") return [sel];
  const year = Math.floor(sel / 12);
  return d.months.filter((x) => Math.floor(x.m / 12) === year && x.m <= d.last).map((x) => x.m);
}

export function periodLabel(list: number[]): string {
  if (overviewState.period === "month") return monthName(list[0]!);
  const a = list[0]!;
  const b = list[list.length - 1]!;
  return a === b ? monthName(a) : `${Math.floor(a / 12)} (${CONFIG.months[a % 12]}–${CONFIG.months[b % 12]})`;
}

export function sumOver(map: Map<number, number>, list: number[]): number {
  return list.reduce((s, m) => s + (map.get(m) || 0), 0);
}

// Share of every 100 earned: "₹12", "<₹1"
export function per100(v: number, income: number): string {
  if (!income) return "–";
  const x = (v / income) * 100;
  return x > 0 && x < 0.5 ? `<${money(1)}` : money(Math.round(x));
}

/* ------------ Drawing ------------ */

export function renderOverview(): void {
  const page = $("overviewPage");
  if (!page || activePage !== "overview") return;
  const d = overviewData();
  if (!d) {
    const loaded = MODULE_KEYS.some((k) => moduleData[k]?.records.length);
    $("ovBody").innerHTML = `<section class="card"><div class="nodata small">${
      loaded
        ? `No income or expenses in ${esc(activeCurrency)} in this workbook. Pick another currency in the side bar.`
        : "Load a workbook with an Income and an Expense sheet to see the overview."
    }</div></section>`;
    $("ovSub").textContent = "Income and Expense sheets combined";
    return;
  }
  if (overviewState.month === null || overviewState.month < d.first || overviewState.month > d.last) {
    overviewState.month = d.bothLast;
  }
  const list = periodMonths(d);
  const label = periodLabel(list);
  const I = sumOver(d.incM, list);
  const E = sumOver(d.expM, list);
  const N = I - E;
  const rate = I ? (N / I) * 100 : null;

  // Same period one step back, for the change lines
  const prevList =
    overviewState.period === "month"
      ? [list[0]! - 1]
      : list.map((m) => m - 12);
  const pI = sumOver(d.incM, prevList);
  const pE = sumOver(d.expM, prevList);
  const pRate = pI ? ((pI - pE) / pI) * 100 : null;
  const prevName = overviewState.period === "month" ? monthName(list[0]! - 1) : "last year";
  const change = (now: number, before: number) => {
    if (!before) return `Nothing to compare in ${prevName}`;
    const p = Math.round(((now - before) / Math.abs(before)) * 100);
    return p === 0 ? `Same as ${prevName}` : `${p > 0 ? "▲" : "▼"} ${Math.abs(p)}% vs ${prevName}`;
  };

  $("ovSub").textContent = `Income and Expense sheets combined · ${label}`;
  document.querySelectorAll<HTMLElement>("#ovPeriod button").forEach((b) => {
    const on = b.dataset.period === overviewState.period;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });

  /* ---- Cards ---- */
  const cards: { label: string; dot: string; value: string; sub: string; cls?: string }[] = [
    { label: "Income", dot: "#2563eb", value: money(I), sub: change(I, pI) },
    { label: "Expenses", dot: "#f59e0b", value: money(E), sub: change(E, pE) },
    {
      label: "Net saved",
      dot: "#0f766e",
      value: money(N),
      sub: N < 0 ? "Spent more than earned" : "Income − expenses",
      cls: N < 0 ? "ov-neg" : "ov-pos",
    },
    {
      label: "Savings rate",
      dot: "#0f766e",
      value: rate === null ? "–" : pctText(rate),
      sub:
        rate === null || pRate === null
          ? "Net saved ÷ income"
          : Math.round(rate - pRate) === 0
            ? `Same as ${prevName}`
            : `${rate > pRate ? "▲" : "▼"} ${Math.abs(Math.round(rate - pRate))} points vs ${prevName}`,
      cls: rate !== null && rate < 0 ? "ov-neg" : "",
    },
  ];
  const cardsHtml = cards
    .map(
      (c) => `<div class="card ov-kpi"><span class="small ov-kpi-label"><span class="ov-dot" style="background:${c.dot}"></span>${esc(c.label)}</span><b class="${c.cls || ""}">${esc(c.value)}</b><span class="small">${esc(c.sub)}</span></div>`,
    )
    .join("");

  /* ---- Monthly chart: last 12 months up to the newest ---- */
  const shown = d.months.slice(-12);
  const top = Math.max(1, ...shown.map((x) => Math.max(x.inc, x.exp)));
  const inPeriod = new Set(list);
  const bars = shown
    .map((x) => {
      const on = inPeriod.has(x.m);
      const h = (v: number) => `${Math.round((v / top) * 100)}%`;
      return `<button type="button" class="ov-month${on ? " on" : ""}" data-month="${x.m}" aria-pressed="${on}" title="${esc(`${monthName(x.m)} · income ${money(x.inc)} · expenses ${money(x.exp)} · net ${money(x.net)}`)}">
          <span class="ov-bars"><span class="ov-bar ov-inc" style="height:${h(x.inc)}"></span><span class="ov-bar ov-exp" style="height:${h(x.exp)}"></span></span>
          <span class="ov-mlabel">${esc(shortMonth(x.m))}</span>
          <span class="ov-net ${x.net < 0 ? "ov-neg" : "ov-pos"}">${esc(signedShort(x.net))}</span>
        </button>`;
    })
    .join("");

  /* ---- Cumulative savings (all months) ---- */
  let run = 0;
  const cum = d.months.map((x) => (run += x.net));
  const W = 520;
  const H = 170;
  const lo = Math.min(0, ...cum);
  const hi = Math.max(1, ...cum);
  const xOf = (i: number) => (cum.length < 2 ? W / 2 : (i / (cum.length - 1)) * W);
  const yOf = (v: number) => 160 - ((v - lo) / (hi - lo || 1)) * 150;
  const pts = cum.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
  const zeroY = yOf(0).toFixed(1);
  const selPos = d.months.findIndex((x) => x.m === list[list.length - 1]);
  const dot = selPos >= 0 ? `<line x1="${xOf(selPos).toFixed(1)}" y1="0" x2="${xOf(selPos).toFixed(1)}" y2="${H}" stroke="#0f766e" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"></line>` : "";
  const cumSvg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative savings from ${esc(monthName(d.first))} to ${esc(monthName(d.last))}" class="ov-cum" preserveAspectRatio="none">
      <line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" stroke="#cbd5e1" vector-effect="non-scaling-stroke"></line>
      <polygon points="0,${zeroY} ${pts} ${W},${zeroY}" fill="#ccfbf1"></polygon>
      <polyline points="${pts}" fill="none" stroke="#0f766e" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"></polyline>
      ${dot}
    </svg>`;

  /* ---- Where income went ---- */
  const inList = new Set(list);
  const byCat = new Map<string, number>();
  for (const r of d.expense) {
    if (!inList.has(monthIndex(r.Date))) continue;
    byCat.set(r.Category, (byCat.get(r.Category) || 0) + r.Amount);
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const shades = ["#b45309", "#d97706", "#f59e0b", "#fbbf24", "#fcd34d", "#92400e"];
  const parts: { name: string; v: number; color: string; saved?: boolean }[] = cats
    .slice(0, 6)
    .map(([name, v], i) => ({ name, v, color: shades[i]! }));
  const rest = cats.slice(6).reduce((s, c) => s + c[1], 0);
  if (rest > 0) parts.push({ name: "Other categories", v: rest, color: "#fde68a" });
  const base = Math.max(I, E, 1); // overspent: share of what was spent
  if (N > 0) parts.push({ name: "Saved", v: N, color: "#0f766e", saved: true });
  const splitBar = parts
    .map((p) => `<span style="width:${((p.v / base) * 100).toFixed(2)}%;background:${p.color}" title="${esc(`${p.name}: ${money(p.v)}`)}"></span>`)
    .join("");
  const splitLegend = parts
    .map(
      (p) => `<div class="ov-leg${p.saved ? " ov-saved" : ""}"><span class="ov-sw" style="background:${p.color}"></span><span class="ov-leg-name">${esc(p.name)}</span><b>${esc(per100(p.v, I))}</b></div>`,
    )
    .join("");
  const splitNote = !I
    ? "No income in this period, so there is nothing to split."
    : N < 0
      ? `Spending was ${money(-N)} more than income in ${label}. The bar shows what was spent.`
      : `Out of every ${money(100)} earned in ${label}`;

  /* ---- Expense cover ---- */
  const recent = d.months.filter((x) => x.m <= d.bothLast).slice(-12);
  const avgExp = recent.length ? recent.reduce((s, x) => s + x.exp, 0) / recent.length : 0;
  const saved = cum[cum.length - 1]!;
  const cover = avgExp > 0 ? Math.max(0, saved) / avgExp : 0;
  const blocks = Array.from({ length: 12 }, (_, i) => {
    const cls = i < Math.floor(cover) ? "full" : i < cover ? "part" : i < 6 ? "target" : "";
    return `<span class="ov-block ${cls}"></span>`;
  }).join("");

  /* ---- Insights ---- */
  const notes = overviewInsights(d, list);

  $("ovBody").innerHTML = `
    <section class="ov-kpis">${cardsHtml}</section>

    <section class="card card-gap" id="ovMonthly">
      <div class="ov-head">
        <div><div class="graphtitle"><b>Income vs expenses by month</b></div><div class="small">Net saved under each month. Click a month to look at it.</div></div>
        <div class="ov-key"><span><span class="ov-sw" style="background:#2563eb"></span>Income</span><span><span class="ov-sw" style="background:#f59e0b"></span>Expenses</span></div>
      </div>
      <div class="ov-scroll"><div class="ov-months">${bars}</div></div>
    </section>

    <div class="ov-grid2 card-gap">
      <section class="card" id="ovCumulative">
        <div class="graphtitle"><b>Cumulative savings</b></div>
        <div class="small">Running total of net saved since ${esc(monthName(d.first))}</div>
        <b class="ov-big ${saved < 0 ? "ov-neg" : "ov-pos"}">${esc(money(saved))}</b>
        ${cumSvg}
        <div class="ov-axis small"><span>${esc(monthName(d.first))}</span><span>${esc(monthName(d.last))}</span></div>
      </section>

      <section class="card" id="ovSplit">
        <div class="graphtitle"><b>Where ${esc(label)}'s income went</b></div>
        <div class="small">${esc(splitNote)}</div>
        <div class="ov-split">${splitBar}</div>
        <div class="ov-legend">${splitLegend}</div>
      </section>
    </div>

    <div class="ov-grid2 card-gap">
      <section class="card" id="ovCover">
        <div class="graphtitle"><b>Expense cover</b></div>
        <div class="small">Months your net saved would last at your average spending</div>
        <b class="ov-cover">${cover.toFixed(1)} <span>months</span></b>
        <div class="ov-blocks">${blocks}</div>
        <div class="small">Net saved ${esc(money(saved))} ÷ average spending ${esc(money(avgExp))} a month (last ${recent.length} months). 6 months is a common safety target. Savings held before ${esc(monthName(d.first))} are not in the sheets, so the real figure may be higher.</div>
      </section>

      <section class="card" id="ovInsights">
        <div class="graphtitle"><b>Insights</b></div>
        <div class="small">Found automatically in your Income and Expense sheets</div>
        <div class="ov-notes">${notes || '<div class="small">Nothing stands out yet.</div>'}</div>
      </section>
    </div>`;
  // Narrow screens: show the newest months first
  const scroller = document.querySelector<HTMLElement>("#ovMonthly .ov-scroll");
  if (scroller) scroller.scrollLeft = scroller.scrollWidth;
}

// Short notes, most useful first
export function overviewInsights(d: OverviewData, list: number[]): string {
  const notes: string[] = [];
  const add = (tag: string, kind: "warn" | "good" | "info", text: string) => notes.push(`<div class="ov-note"><span class="ov-tag ov-tag-${kind}">${esc(tag)}</span><span>${esc(text)}</span></div>`);
  const last12 = d.months.filter((x) => x.m <= d.bothLast).slice(-12);

  // 1. Months that spent more than they earned
  const over = last12.filter((x) => x.inc > 0 && x.net < 0);
  const noInc = last12.filter((x) => x.inc === 0 && x.exp > 0);
  if (over.length) {
    add(
      "Overspent",
      "warn",
      over.length === 1
        ? `${monthName(over[0]!.m)} is the only month in the last ${last12.length} where you spent more than you earned: expenses ${money(over[0]!.exp)} against income ${money(over[0]!.inc)}.`
        : `In ${over.length} of the last ${last12.length} months you spent more than you earned: ${over.map((x) => shortMonth(x.m)).join(", ")}.`,
    );
  } else if (last12.length >= 3) {
    add("On track", "good", `You earned more than you spent in every month of the last ${last12.length} months that had income.`);
  }
  if (noInc.length) {
    add("No income", "info", `${noInc.length} month${noInc.length > 1 ? "s" : ""} had spending but no income recorded: ${noInc.map((x) => shortMonth(x.m)).join(", ")}. Check the Income sheet if that is not right.`);
  }

  // 2. Savings rate of the selected month vs the last 6 months
  if (overviewState.period === "month") {
    const m = list[0]!;
    const rateOf = (x: MonthSummary): number | null => (x.inc ? (x.net / x.inc) * 100 : null);
    const recent = d.months.filter((x) => x.m <= m && x.m > m - 6 && x.inc > 0);
    const cur = d.months.find((x) => x.m === m);
    const curRate = cur ? rateOf(cur) : null;
    if (curRate !== null && recent.length >= 3) {
      const rates = recent.map((x) => rateOf(x)!);
      if (curRate <= Math.min(...rates)) {
        add("Lowest", "warn", `Savings rate in ${monthName(m)} was ${pctText(curRate)}, the lowest of the last ${recent.length} months.`);
      } else if (curRate >= Math.max(...rates)) {
        add("Best", "good", `Savings rate in ${monthName(m)} was ${pctText(curRate)}, the best of the last ${recent.length} months.`);
      }
    }
  }

  // 3. Spending vs income growth: this year so far vs the same months last year
  const lastYear = Math.floor(d.bothLast / 12);
  const ytd = d.months.filter((x) => Math.floor(x.m / 12) === lastYear && x.m <= d.bothLast).map((x) => x.m);
  const prev = ytd.map((m) => m - 12);
  const iNow = sumOver(d.incM, ytd);
  const eNow = sumOver(d.expM, ytd);
  const iPrev = sumOver(d.incM, prev);
  const ePrev = sumOver(d.expM, prev);
  if (iPrev > 0 && ePrev > 0) {
    const gi = ((iNow - iPrev) / iPrev) * 100;
    const ge = ((eNow - ePrev) / ePrev) * 100;
    const kind = ge > gi ? "warn" : "good";
    add(
      ge > gi ? "Faster" : "Good pace",
      kind,
      `${lastYear} so far against the same months of ${lastYear - 1}: spending ${ge >= 0 ? "grew" : "fell"} ${Math.abs(Math.round(ge))}%, income ${gi >= 0 ? "grew" : "fell"} ${Math.abs(Math.round(gi))}%.`,
    );
  }

  // 4. Category that rose most in the selected month vs its 3-month average
  if (overviewState.period === "month") {
    const m = list[0]!;
    const at = new Map<string, number>();
    const before = new Map<string, number>();
    for (const r of d.expense) {
      const i = monthIndex(r.Date);
      if (i === m) at.set(r.Category, (at.get(r.Category) || 0) + r.Amount);
      else if (i < m && i >= m - 3) before.set(r.Category, (before.get(r.Category) || 0) + r.Amount);
    }
    let best: { cat: string; v: number; avg: number; diff: number } | null = null;
    for (const [cat, v] of at) {
      const avg = (before.get(cat) || 0) / 3;
      const diff = v - avg;
      if (avg > 0 && diff > 0 && (!best || diff > best.diff)) best = { cat, v, avg, diff };
    }
    if (best && best.diff / best.avg >= 0.25) {
      add("Rose", "info", `${best.cat} was ${money(best.v)} in ${monthName(m)}, ${Math.round((best.diff / best.avg) * 100)}% above its 3-month average of ${money(best.avg)}.`);
    }
  }
  return notes.join("");
}

/* ------------ Switching pages ------------ */

// Show a full-width page ("overview", "market") or, with null, the module pages
const WIDE_PAGES: Record<"overview" | "market", string> = { overview: "Overview", market: "Market" };
export function showPage(page: "overview" | "market" | null): void {
  activePage = page || activeModule;
  document.querySelector(".app")!.classList.toggle("is-wide", !!page);
  for (const key of Object.keys(WIDE_PAGES) as (keyof typeof WIDE_PAGES)[]) $(`${key}Page`).hidden = page !== key;
  $("modulePage").hidden = !!page;
  document.querySelectorAll<HTMLElement>(".side-item[data-page]").forEach((b) => {
    const on = b.dataset.page === page;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (page) {
    document.querySelectorAll(".side-item[data-module]").forEach((b) => {
      b.classList.remove("active");
      b.removeAttribute("aria-current");
    });
    document.title = `${WIDE_PAGES[page]} · Finance Analytics`;
  }
}

function showOverview(on: boolean): void {
  showPage(on ? "overview" : null);
}

// Currencies offered on the Overview: those of both modules
function setupOverviewCurrency(): void {
  const lists = MODULE_KEYS.map((k) => {
    const d = moduleData[k];
    if (!d) return [];
    return d.settings.currencies.length ? d.settings.currencies : [...new Set(d.records.map((r) => r.Currency))];
  });
  const options = [...new Set(lists.flat())];
  const first = options.includes(activeCurrency) ? activeCurrency : options[0] || CONFIG.currency;
  $("currency").innerHTML = options
    .map(
      (code) =>
        `<label class="cur-opt" title="${esc(code)}"><input type="radio" name="currency" value="${esc(code)}"${code === first ? " checked" : ""} aria-label="${esc(code)}"><span aria-hidden="true">${esc(currencySymbol(code))}</span></label>`,
    )
    .join("");
  $("currency").hidden = options.length < 2;
  setActiveCurrency(first);
  setMoneyCurrency(first);
}

export function selectOverview(): void {
  showOverview(true);
  setupOverviewCurrency();
  renderOverview();
}

export function setupOverview(): void {
  document.querySelectorAll<HTMLElement>(".side-item[data-page='overview']").forEach((b) => {
    b.onclick = () => {
      if (activePage === "overview") return;
      selectOverview();
      window.scrollTo({ top: 0 });
    };
  });
  $("ovPeriod").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("button[data-period]");
    if (!b) return;
    overviewState.period = b.dataset.period as "month" | "year";
    renderOverview();
  });
  $("ovBody").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>(".ov-month");
    if (!b) return;
    overviewState.period = "month";
    overviewState.month = Number(b.dataset.month);
    renderOverview();
  });
}
