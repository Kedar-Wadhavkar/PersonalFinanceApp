import { CONFIG } from "./config";
import { activeModule, moduleData } from "./modules";
import { displayDate } from "./settings";
import { activeCurrency, rows, view } from "./state";
import type { ModuleKey, Transaction } from "./types";
import { $, esc, money, moneyShort } from "./utils";

/* =========================================================================
insights.ts
The insights panel on the right of the page (#insights).

Redrawn after every change of the dashboard filters (called from render()
in dashboard.ts), so it always describes what the page shows now:
  1. Your selection ..... total, entries, average entry, latest month vs
                          the month before (the dashboard filters apply)
  2. Biggest moves ...... per category: latest month of the data vs the
                          month before (all records of this currency)
  3. Top 5 entries ...... largest records of the selection; a click
                          searches the table for it
  4. This month ......... income vs spending of the latest month, read from
                          BOTH modules (same currency)
  5. Budgets ............ placeholder until a Budget sheet exists
========================================================================= */

// "2026-10-17" -> month number since year 0 (2026*12 + 9), for comparing
export const monthIndex = (iso: string): number => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
export const monthName = (i: number): string => `${CONFIG.months[i % 12]} ${Math.floor(i / 12)}`;

// Total per month index of a list of records
export function totalsByMonth(list: Transaction[]): Map<number, number> {
  const totals = new Map<number, number>();
  for (const r of list) {
    const m = monthIndex(r.Date);
    totals.set(m, (totals.get(m) || 0) + r.Amount);
  }
  return totals;
}

// "▲ 18% more than Sep 2026" / "▼ 7% less ..." / "" when not comparable
export function changeText(now: number, before: number | undefined, beforeName: string): string {
  if (!before) return "";
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  if (pct === 0) return `Same as ${beforeName}`;
  return pct > 0
    ? `▲ ${pct}% more than ${beforeName}`
    : `▼ ${Math.abs(pct)}% less than ${beforeName}`;
}

// Colour of a rise: bad (amber) for spending, good (teal) for income
const UP_COLOR = (): string => (activeModule === "income" ? "#0f766e" : "#b45309");
const DOWN_COLOR = (): string => (activeModule === "income" ? "#b45309" : "#0f766e");

export function renderInsights(): void {
  const box = $("insights");
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = `<section class="rail-card"><span class="rail-label">Insights</span><div class="small">Load a workbook to see insights about what is on the page.</div></section>`;
    return;
  }

  /* ---- 1. Your selection ---- */
  const recs = view.records;
  const count = recs.length;
  const byMonth = totalsByMonth(recs);
  const lastM = byMonth.size ? Math.max(...byMonth.keys()) : null;
  let monthLine = "";
  if (lastM !== null) {
    const now = byMonth.get(lastM)!;
    const before = byMonth.get(lastM - 1);
    const change = changeText(now, before, monthName(lastM - 1));
    const up = before && now > before;
    monthLine =
      `<div class="rail-row"><span>${esc(monthName(lastM))}</span><b>${esc(money(now))}</b></div>` +
      (change
        ? `<div class="rail-change" style="color:${up ? UP_COLOR() : DOWN_COLOR()}">${esc(change)}</div>`
        : "");
  }
  const selection = `
    <section class="rail-card">
      <span class="rail-label">Your selection</span>
      <b class="rail-big">${esc(money(view.sum))}</b>
      <div class="rail-pair">
        <div><span>Entries</span><b>${count.toLocaleString(CONFIG.locale)}</b></div>
        <div><span>Average entry</span><b>${esc(money(count ? view.sum / count : 0))}</b></div>
      </div>
      ${monthLine ? `<span class="rail-sub">Latest month in the selection</span>${monthLine}` : ""}
    </section>`;

  /* ---- 2. Biggest moves: latest month of the data vs the month before ---- */
  let latest = -1;
  for (const r of rows) latest = Math.max(latest, monthIndex(r.Date));
  const nowCat = new Map<string, number>();
  const prevCat = new Map<string, number>();
  for (const r of rows) {
    const m = monthIndex(r.Date);
    if (m === latest) nowCat.set(r.Category, (nowCat.get(r.Category) || 0) + r.Amount);
    else if (m === latest - 1) prevCat.set(r.Category, (prevCat.get(r.Category) || 0) + r.Amount);
  }
  const moves = [...new Set([...nowCat.keys(), ...prevCat.keys()])]
    .map((name) => {
      const now = nowCat.get(name) || 0;
      const before = prevCat.get(name) || 0;
      return { name, now, before, diff: now - before };
    })
    .filter((m) => m.diff !== 0)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 6);
  const maxDiff = Math.max(1, ...moves.map((m) => Math.abs(m.diff)));
  const moveRows = moves
    .map((m) => {
      const up = m.diff > 0;
      const color = up ? UP_COLOR() : DOWN_COLOR();
      const pct = m.before ? `${up ? "+" : "−"}${Math.abs(Math.round((m.diff / m.before) * 100))}%` : "new";
      const width = Math.max(4, Math.round((Math.abs(m.diff) / maxDiff) * 100));
      return `<div class="rail-move" title="${esc(`${monthName(latest)}: ${money(m.now)} · ${monthName(latest - 1)}: ${money(m.before)}`)}">
          <div class="rail-row"><span>${esc(m.name)}</span><b style="color:${color}">${pct} <span class="rail-diff">${up ? "+" : "−"}${esc(moneyShort(Math.abs(m.diff)))}</span></b></div>
          <div class="rail-track"><div style="width:${width}%;background:${color}"></div></div>
        </div>`;
    })
    .join("");
  const movesCard = `
    <section class="rail-card">
      <span class="rail-label">${esc(monthName(latest))} vs ${esc(CONFIG.months[(latest - 1) % 12])} · biggest moves</span>
      ${moveRows || '<div class="small">No change between these two months.</div>'}
    </section>`;

  /* ---- 3. Top 5 entries of the selection ---- */
  const top = [...recs].sort((a, b) => b.Amount - a.Amount).slice(0, 5);
  const topRows = top
    .map(
      (r) => `<button type="button" class="rail-entry" data-find="${esc(r.Particular || r.Category)}">
          <span class="rail-entry-text"><span>${esc(r.Particular || r.Category)}</span><span class="small">${esc(displayDate(r.Date))} · ${esc(r.Category)}</span></span>
          <b>${esc(money(r.Amount))}</b>
        </button>`,
    )
    .join("");
  const topCard = `
    <section class="rail-card">
      <span class="rail-label">Top 5 entries</span>
      ${topRows || '<div class="small">Nothing selected.</div>'}
    </section>`;

  /* ---- 4. This month: income vs spending (both modules, same currency) ---- */
  const inCur = (key: ModuleKey): Transaction[] =>
    (moduleData[key]?.records || []).filter((r) => r.Currency === activeCurrency);
  const income = inCur("income");
  const expense = inCur("expense");
  // The latest month BOTH sheets have reached (so a month without any
  // income yet is not shown as "no income")
  const lastOf = (list: Transaction[]) => list.reduce((a, r) => Math.max(a, monthIndex(r.Date)), -1);
  const both = Math.min(lastOf(income), lastOf(expense));
  const sumIn = (list: Transaction[]) => list.reduce((a, r) => a + (monthIndex(r.Date) === both ? r.Amount : 0), 0);
  const inc = sumIn(income);
  const exp = sumIn(expense);
  let monthCard: string;
  if (!income.length || !expense.length) {
    monthCard = `<section class="rail-card"><span class="rail-label">Income vs spending</span><div class="small">Needs both an Income and an Expense sheet in this currency.</div></section>`;
  } else {
    const kept = inc ? Math.round(((inc - exp) / inc) * 100) : null;
    const spentShare = inc ? Math.min(100, Math.max(0, Math.round((exp / inc) * 100))) : 100;
    monthCard = `
      <section class="rail-card">
        <span class="rail-label">${esc(monthName(both))} · income vs spending</span>
        <div class="rail-row"><span>Income</span><b class="rail-income">${esc(money(inc))}</b></div>
        <div class="rail-row"><span>Spent</span><b>${esc(money(exp))}</b></div>
        <div class="rail-split" title="Share of income spent"><div style="width:${spentShare}%"></div></div>
        <div class="rail-change" style="color:${kept !== null && kept >= 0 ? "#0f766e" : "#b45309"}">${
          kept === null
            ? "No income recorded this month"
            : kept >= 0
              ? `You kept ${kept}% of this month's income`
              : `You spent ${Math.abs(kept)}% more than you earned`
        }</div>
      </section>`;
  }

  /* ---- 5. Budgets (later) ---- */
  const budgetCard = `
    <section class="rail-card rail-later">
      <span class="rail-label">Budgets · coming later</span>
      <div class="small">Monthly limits per category from a Budget sheet will show here as progress bars.</div>
    </section>`;

  box.innerHTML = selection + movesCard + topCard + monthCard + budgetCard;
}

// A click on a top entry searches the transactions table for it
export function setupInsights(): void {
  $("insights").addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLElement>(".rail-entry");
    if (!btn) return;
    $<HTMLInputElement>("search").value = btn.dataset.find!;
    $("search").dispatchEvent(new Event("input"));
    $("secTx").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
