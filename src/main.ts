import "../styles/main.css";
import { renderCategoryYear, resetCategoryYear } from "./categoryCompare";
import { CONFIG } from "./config";
import { redrawAreas, render, setupBarClicks, setupBarFilterResets, setupKpiSwitch, setupUpperSort } from "./dashboard";
import { relayoutDonuts, resetDonuts } from "./donuts";
import { parseMatrices, workbookMatrices } from "./excel";
import { FILTER_PREFIXES, filterMultiIds } from "./filterGroup";
import { resetDashboardFilters, updateSearchClear } from "./filters";
import { relayoutHeatmap, resetHeatmap, setupHeatmapClicks } from "./heatmap";
import { setupInsights } from "./insights";
import { setupRecurring } from "./recurringPanel";
import { renderLineChart, setupLineChartEvents } from "./lineChart";
import { parseMarket, selectMarket, setMarketData, setupMarket, updateMarketCount } from "./market";
import { resetSimulator } from "./forecast";
import { nwState, parseAccounts, selectNetWorth, setAccountsData, setupNetWorth, updateNetWorthCount } from "./networth";
import { MODULES, MODULE_KEYS, activeModule, moduleData, selectModule, setupModuleNav } from "./modules";
import { renderMultiYear, resetMultiYear } from "./monthlyCompare";
import { activePage, overviewState, selectOverview, setupOverview, showPage } from "./overview";
import { setupEmptyState } from "./emptyState";
import { setupSettings } from "./settings";
import { resetTableMetrics, scrollTableToTop, setupTxSort } from "./table";
import type { ModuleKey, ModuleParseResult, SheetMatrix } from "./types";
import { $, closeMenus, debounce, esc, setMenuOpen, wireMultiToggles } from "./utils";

/* =========================================================================
main.ts
Start-up: connects buttons to the functions in the other files.
This is the entry point that Vite builds (see index.html).
========================================================================= */

/* ------------ Loading a workbook ------------ */

// Several files may be chosen at once (e.g. the finance workbook and the
// market file); their sheets are read together. A part (Expense + Income,
// Market) that the chosen files do not contain keeps what was loaded before.
const loadedFiles = { finance: "", market: "" };

$<HTMLInputElement>("file").onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  if (!files.length) return;

  // Show that a (large) file is being read: the button text, and a
  // panel over the page that also says the file stays on this device
  const label = $("uploadText");
  label.textContent = "Loading...";
  input.closest(".upload")!.setAttribute("aria-busy", "true");
  $("loadingText").textContent = files.length > 1 ? `Reading ${files.length} files` : `Reading ${files[0]!.name}`;
  $("loading").hidden = false;
  document.querySelector(".app")!.setAttribute("aria-busy", "true");
  // Let the browser paint the panel before the (blocking) parsing starts
  await new Promise<void>((done) => requestAnimationFrame(() => setTimeout(done, 0)));

  try {
    const sheets: SheetMatrix[] = [];
    const names = files.map((f) => f.name).join(", ");
    for (const file of files) sheets.push(...(await workbookMatrices(await file.arrayBuffer())));
    const parsed = {} as Record<ModuleKey, ModuleParseResult>;
    MODULE_KEYS.forEach((key) => (parsed[key] = parseMatrices(sheets, MODULES[key])));
    const market = parseMarket(sheets);
    const accounts = parseAccounts(sheets);
    const total = MODULE_KEYS.reduce((n, key) => n + parsed[key].records.length, 0);
    const wasPage = activePage;
    if (!total && !market && !accounts?.entries.length) {
      const skippedAll = MODULE_KEYS.reduce((n, key) => n + parsed[key].skipped.count, 0);
      throw Error(
        skippedAll
          ? `tables found, but none of their ${skippedAll} rows had a readable date and amount`
          : 'no usable rows: check the sheet names ("Expense", "Income"), the table headings (Date, Amount, Category, Mode; for the Accounts sheet Date, Account, Type, Balance; for the market file Date, Order, Holding, Units, UnitAvg) and the settings sheets',
      );
    }

    if (total) {
      MODULE_KEYS.forEach((key) => (moduleData[key] = parsed[key]));
      loadedFiles.finance = names;
    }
    if (accounts) {
      setAccountsData(accounts);
      if (!total) loadedFiles.finance = names;
    }
    if (market) {
      setMarketData(market);
      loadedFiles.market = names;
    }
    const shown = [...new Set([loadedFiles.finance, loadedFiles.market].filter(Boolean))].join(" · ");
    $("fileName").textContent = shown;
    $("fileName").title = shown;
    updateMarketCount();
    updateNetWorthCount();
    resetSimulator();

    if (total) {
      // Stay on the module shown, unless it has nothing in this workbook
      const stay = parsed[activeModule].records.length;
      selectModule(stay ? activeModule : MODULE_KEYS.find((k) => parsed[k].records.length)!);
    }
    if (wasPage === "networth" || (accounts && !total && !market)) {
      // Stay on (or open) the Net worth page, at the newest month
      nwState.month = null;
      selectNetWorth();
    } else if (total && parsed.income.records.length && parsed.expense.records.length) {
      // Both Income and Expense: there is something to combine, open the Overview
      overviewState.month = null;
      selectOverview();
    } else if (market && (!total || activePage === "market")) {
      selectMarket();
    } else if (activePage === "overview") {
      selectOverview();
    }
    window.scrollTo({ top: 0 });
  } catch (x: unknown) {
    if (activePage !== activeModule) showPage(null); // the message is on the module page
    $("err").innerHTML =
      '<div class="error">Could not read the workbook. Use an .xlsx file with "Expense" and/or "Income" sheets, each with Date, Amount, Category and Mode headings (plus Particulars, Currency, Credit, Principle if you have them) in one of the first 5 rows, and a year heading above each block. Technical detail: ' +
        esc((x instanceof Error && x.message) || x) +
      "</div>";
  } finally {
    label.textContent = "Load Excel";
    input.closest(".upload")!.removeAttribute("aria-busy");
    $("loading").hidden = true;
    document.querySelector(".app")!.removeAttribute("aria-busy");
    // Clear the choice, so picking the SAME file again (e.g. after editing
    // it in Excel) still triggers a reload
    input.value = "";
  }
};

/* ------------ Dropdowns, buttons and search ------------ */

FILTER_PREFIXES.forEach((prefix) => wireMultiToggles(filterMultiIds(prefix)));
wireMultiToggles(["lcCatMulti"]);

// ONE rule for every menu (filter dropdowns and sort menus):
// - a click anywhere closes all open menus except the one it happened in.
// - So opening one menu closes any other, and clicking outside closes all.
// - composedPath() is the list of elements the click passed through, taken
//   when the click happened (still correct if the menu redraws itself).
document.addEventListener("click", (e) => {
    const open = document.querySelectorAll(".sortwrap.open, .multi.open");
    if (!open.length) return;
    const path = e.composedPath();
    open.forEach((menu) => {
        if (!path.includes(menu)) setMenuOpen(menu, false);
    });
});

document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = document.querySelector(".sortwrap.open, .multi.open");
    if (!open) return;
    closeMenus();
    open.querySelector<HTMLButtonElement>(":scope > button")?.focus();
});

$("dashReset").onclick = resetDashboardFilters;
$("myReset").onclick = resetMultiYear;
$("cyReset").onclick = resetCategoryYear;
$("hmReset").onclick = resetHeatmap;
$("dnReset").onclick = resetDonuts;
const renderSoon = debounce(render, CONFIG.searchDebounceMs);
$("search").oninput = () => {
    updateSearchClear();
    scrollTableToTop(); // jump to the top row as soon as you type
    renderSoon();
};
$("searchClear").onclick = () => {
    $<HTMLInputElement>("search").value = "";
    updateSearchClear();
    scrollTableToTop();
    render();
    $("search").focus();
};

/* ------------ Go-to-top button ------------ */

// Shown once the page is scrolled down a little; scrolls smoothly (CSS)
const toTop = $("toTop");
window.addEventListener(
  "scroll",
  () => {
    toTop.hidden = window.scrollY < 400;
  },
  { passive: true },
);
toTop.onclick = () => window.scrollTo({ top: 0 });

/* ------------ Insights panel placement ------------ */

// Wide screens: the panel is a column on the right. Phones: it moves into
// the page, under the KPI cards, so the page title and the headline figures
// come first and the insights sit next to the charts they describe.
const rail = document.querySelector<HTMLElement>(".rail")!;
const railHome = rail.parentElement!;
const railNext = rail.nextSibling;
const phone = window.matchMedia("(max-width: 800px)");
function placeRail(): void {
  if (phone.matches) document.querySelector("#modulePage .kpis")!.after(rail);
  else if (rail.parentElement !== railHome) railHome.insertBefore(rail, railNext);
}
placeRail();
phone.addEventListener("change", placeRail);

/* ------------ First draw (empty page, before a file is loaded) ------------ */

setupSettings();
setupEmptyState();
setupModuleNav();
setupInsights();
setupRecurring();
setupOverview();
setupMarket();
setupNetWorth();
setupLineChartEvents();
setupUpperSort();
setupKpiSwitch();
setupBarFilterResets();
setupBarClicks();
setupHeatmapClicks();
setupTxSort();
selectModule(activeModule);

// On resize: the table's row height, the bar positions under the area
// curves, the width of the category comparison chart and the number of
// calendar months / donuts per row can change – but only with the WIDTH.
// Phones fire "resize" whenever the address bar slides in or out while
// scrolling (height only), so those events are ignored: no redraws, no
// jank while scrolling.
let lastWidth = window.innerWidth;
window.addEventListener(
  "resize",
  debounce(() => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    resetTableMetrics();
    redrawAreas();
    renderLineChart();
    renderCategoryYear();
    renderMultiYear(); // both comparison charts fill the card width
    relayoutHeatmap(); // months per row may have changed
    relayoutDonuts();  // donuts per row may have changed
  }, 120),
);
