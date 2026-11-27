import { hasMarketData } from "./market";
import { hasAccountsData } from "./networth";
import { MODULES, MODULE_KEYS, activeModule, moduleData } from "./modules";
import { allRows } from "./state";
import { $, esc } from "./utils";

/* =========================================================================
emptyState.ts
What the Expense / Income page shows when it has nothing to draw:
  - before any file is loaded: a welcome card (how to start + privacy)
  - a workbook is loaded but has no rows for this module: a short note
    saying which sheet is missing.
The charts, filters and insights panel are hidden meanwhile (CSS:
.app.module-empty), so the page is not a wall of "No data selected".
========================================================================= */

const LOCK_ICON =
  '<svg class="lock-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>';

export const PRIVACY_POINTS = [
  "Your files are read by this page, inside your browser.",
  "Nothing is uploaded or sent to a server. The published site is not even allowed to connect to the internet once it has loaded.",
  "Nothing is saved. Refresh or close the tab and the data is gone.",
];

function welcomeHtml(): string {
  return `
    <div class="empty-main">
      <span class="empty-eyebrow">Get started</span>
      <h1 class="empty-title">See where your money goes</h1>
      <p class="empty-text">Load your finance workbook to turn its sheets into charts and tables for spending, income, savings and investments.</p>
      <div class="empty-actions">
        <button type="button" class="btn btn-primary" data-pick-file>Load Excel</button>
        <a class="btn btn-secondary" href="sample-workbook.xlsx" download>Download a sample workbook</a>
      </div>
      <ol class="empty-steps">
        <li><b>Expense</b> and <b>Income</b> sheets, each with the headings Date, Amount, Category and Mode in one of the first 5 rows.</li>
        <li>Optional: an <b>Accounts</b> sheet (Date, Account, Type, Balance) with your bank, deposit, property and loan balances, for the Net worth page.</li>
        <li>Optional: your <b>market file</b> with the orders (Date, Order, Holding, Units, UnitAvg). Choose it together with the workbook.</li>
        <li>After editing the file in Excel, load it again to refresh the charts.</li>
      </ol>
    </div>
    <aside class="privacy-panel" aria-label="Privacy">
      <div class="privacy-head">${LOCK_ICON}<b>Your data stays on this device</b></div>
      <ul>${PRIVACY_POINTS.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
    </aside>`;
}

function noRowsHtml(): string {
  const m = MODULES[activeModule];
  const skipped = moduleData[activeModule]?.skipped.count ?? 0;
  const why = skipped
    ? `An "${esc(m.title)}" table was found, but none of its ${skipped} rows had a readable date and amount.`
    : `The loaded workbook has no "${esc(m.title)}" sheet with Date, Amount, Category and Mode headings.`;
  return `
    <div class="empty-main">
      <span class="empty-eyebrow">${esc(m.title)}</span>
      <h2 class="empty-title">No ${esc(m.text.noun)} rows yet</h2>
      <p class="empty-text">${why} Add them in Excel and load the file again.</p>
      <div class="empty-actions">
        <button type="button" class="btn btn-primary" data-pick-file>Load Excel</button>
      </div>
    </div>`;
}

export function anyDataLoaded(): boolean {
  return MODULE_KEYS.some((k) => (moduleData[k]?.records.length ?? 0) > 0) || hasMarketData() || hasAccountsData();
}

/** Show or hide the empty state of the module page. Called by render(). */
export function updateModuleEmpty(): void {
  const empty = allRows.length === 0;
  const app = document.querySelector(".app")!;
  app.classList.toggle("module-empty", empty);
  app.classList.toggle("no-data", !anyDataLoaded());
  const box = $("moduleEmpty");
  box.hidden = !empty;
  box.classList.toggle("is-welcome", empty && !anyDataLoaded());
  if (empty) box.innerHTML = anyDataLoaded() ? noRowsHtml() : welcomeHtml();
}

/** The "Load Excel" buttons in empty states open the same file chooser as
    the one in the side bar (one handler for all of them, also for the ones
    drawn later). */
export function setupEmptyState(): void {
  document.addEventListener("click", (e) => {
    if ((e.target as Element).closest?.("[data-pick-file]")) $("file").click();
  });
}
