import { analyzeTransactions, type Anomaly, type RecurringItem } from "./analyzer";
import { CONFIG } from "./config";
import { activeModule } from "./modules";
import { displayDate } from "./settings";
import { rows } from "./state";
import { $, esc, money } from "./utils";

/* =========================================================================
recurringPanel.ts
The "Recurring bills & anomalies" card of the Expense page (#secRecurring).

Reads every record of the selected currency (`rows`), not the dashboard
filters: a subscription is still a subscription when the filters show one
month only. Redrawn by rebuildAll() whenever a workbook is loaded, the
module changes or another currency is picked. Hidden on the Income page.
The rules live in analyzer.ts.
========================================================================= */

/** Anomalies shown before "and N more". */
export const MAX_ANOMALIES = 8;

const FREQ_TEXT = { monthly: "Monthly", annual: "Yearly" } as const;

function recurringRow(r: RecurringItem): string {
  const tag = r.active ? "" : ' <span class="rb-tag">stopped?</span>';
  return `<tr class="${r.active ? "" : "rb-stale"}">
      <td><button type="button" class="rb-find" data-find="${esc(r.name)}">${esc(r.name)}</button>${tag}<div class="small">${esc(r.category)} · ${r.count} payments</div></td>
      <td>${FREQ_TEXT[r.frequency]}</td>
      <td class="rb-num">${esc(money(r.typicalAmount))}</td>
      <td>${esc(displayDate(r.lastDate))}</td>
      <td>${r.active ? esc(displayDate(r.nextDate)) : "–"}</td>
      <td class="rb-num"><b>${r.active ? esc(money(r.annualCost)) : "–"}</b></td>
    </tr>`;
}

function anomalyRow(a: Anomaly): string {
  const r = a.record;
  const label = r.Particular || r.Category;
  const times = a.ratio >= 10 ? Math.round(a.ratio) : Math.round(a.ratio * 10) / 10;
  return `<button type="button" class="rail-entry rb-anomaly rb-${a.severity}" data-find="${esc(label)}">
      <span class="rb-dot" aria-hidden="true"></span>
      <span class="rail-entry-text"><span>${esc(label)}</span><span class="small">${esc(displayDate(r.Date))} · ${esc(a.category)} · ${times}× the usual ${esc(money(a.categoryAverage))}</span></span>
      <b>${esc(money(r.Amount))}</b>
    </button>`;
}

export function renderRecurring(): void {
  const box = $("secRecurring");
  if (!box) return;
  box.hidden = activeModule !== "expense";
  const link = document.querySelector<HTMLElement>('.side-item[href="#secRecurring"]');
  if (link) link.hidden = box.hidden;
  if (box.hidden) return;
  if (!rows.length) {
    // The welcome / "no rows" card covers the page (emptyState.ts)
    $("recurringBody").innerHTML = "";
    return;
  }

  const { recurring, anomalies, annualCost } = analyzeTransactions(rows);
  const active = recurring.filter((r) => r.active);
  const n = (v: number) => v.toLocaleString(CONFIG.locale);

  const stats = `
    <div class="rb-stats">
      <div class="rb-stat"><span class="small">Subscriptions &amp; bills per year</span><b id="rbAnnual">${esc(money(annualCost))}</b></div>
      <div class="rb-stat"><span class="small">Per month</span><b>${esc(money(annualCost / 12))}</b></div>
      <div class="rb-stat"><span class="small">Active recurring</span><b>${n(active.length)}</b></div>
      <div class="rb-stat"><span class="small">Unusual entries</span><b>${n(anomalies.length)}</b></div>
    </div>`;

  const recurringHtml = recurring.length
    ? `<div class="scroll rb-scroll"><table class="rb-table">
        <colgroup><col style="width: 32%" /><col style="width: 13%" /><col style="width: 13%" /><col style="width: 14%" /><col style="width: 14%" /><col style="width: 14%" /></colgroup>
        <thead><tr><th>Bill</th><th>How often</th><th class="rb-num">Usual</th><th>Last paid</th><th>Next due</th><th class="rb-num">Per year</th></tr></thead>
        <tbody>${recurring.map(recurringRow).join("")}</tbody>
      </table></div>`
    : '<div class="small nodata">No payments repeat monthly or yearly at a steady amount yet.</div>';

  const shown = anomalies.slice(0, MAX_ANOMALIES);
  const more = anomalies.length - shown.length;
  const anomaliesHtml = shown.length
    ? `<div class="rb-anomalies">${shown.map(anomalyRow).join("")}</div>` + (more > 0 ? `<div class="small rb-more">and ${n(more)} more</div>` : "")
    : '<div class="small nodata">Nothing stands out: every entry is close to its category average.</div>';

  $("recurringBody").innerHTML = `${stats}
    <div class="rb-grid">
      <div class="subcard"><div class="graphtitle"><b>Recurring bills</b></div><div class="small">Same merchant, steady amount, every month or year</div>${recurringHtml}</div>
      <div class="subcard"><div class="graphtitle"><b>Anomalies</b></div><div class="small">At least 2× the category average and far above its usual spread</div>${anomaliesHtml}</div>
    </div>`;
}

// A click on a bill or an anomaly searches the transactions table for it
export function setupRecurring(): void {
  $("secRecurring").addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLElement>("[data-find]");
    if (!btn) return;
    $<HTMLInputElement>("search").value = btn.dataset.find!;
    $("search").dispatchEvent(new Event("input"));
    $("secTx").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
