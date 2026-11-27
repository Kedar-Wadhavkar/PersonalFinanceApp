import { CONFIG } from "./config";
import { updateSearchClear } from "./filters";
import { showPage, activePage } from "./overview";
import { rebuildAll } from "./rebuild";
import { setupCurrency } from "./settings";
import { emptySettings, setAllRows, setSettings } from "./state";
import type { ModuleDefinition, ModuleKey, ModuleParseResult, ModuleTextKey } from "./types";
import { $, esc } from "./utils";

/* =========================================================================
modules.ts
The modules of the app (Expense, Income) and switching between them.

One workbook holds every module: each module reads its own sheet
("Expense", "Income") and its own settings sheet ("Expense_Settings",
"Income_Settings"). All pages share the same cards and code; a module only
changes WHICH records are shown and a few words ("spending" / "income").
========================================================================= */

export const MODULES: Record<ModuleKey, ModuleDefinition> = {
  expense: {
    title: "Expense",
    sheet: "expense", // sheet name, lower case, spaces/dashes as "_"
    // Settings sheets, first found wins. "settings" keeps older workbooks working.
    settingsSheets: ["expense_settings", "settings"],
    settingsLabel: "Expense_Settings",
    legacy: true, // a workbook WITHOUT module sheets is read as expenses
    text: {
      noun: "expense", // "Total expense"
      flow: "spending", // "Daily spending calendar"
      Flow: "Spending", // "Spending trend"
      Share: "Expenditure", // "Share of Expenditure"
      none: "no spending", // calendar day without records
      noDay: "no-spend day",
    },
  },
  income: {
    title: "Income",
    sheet: "income",
    settingsSheets: ["income_settings"],
    settingsLabel: "Income_Settings",
    legacy: false,
    text: {
      noun: "income",
      flow: "income",
      Flow: "Income",
      Share: "Income",
      none: "no income",
      noDay: "income-free day",
    },
  },
};
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

// The module shown now, and what the workbook gave each module
// (parseMatrices result: records, skipped, settings, settingsSheetName)
export let activeModule: ModuleKey = "expense";
export const moduleData: Record<ModuleKey, ModuleParseResult | null> = { expense: null, income: null };

// Word of the active module: T("flow") -> "spending" / "income"
export function T(key: ModuleTextKey): string {
  return MODULES[activeModule].text[key];
}

// Put the active module's words into the page:
// data-t="Daily {flow} calendar" -> "Daily income calendar"
function applyModuleTexts(): void {
  const fill = (pattern: string) => pattern.replace(/\{(\w+)\}/g, (_m, k: string) => T(k as ModuleTextKey));
  document.querySelectorAll<HTMLElement>("[data-t]").forEach((el) => {
    el.textContent = fill(el.dataset.t!);
  });
  document.querySelectorAll<HTMLElement>("[data-t-label]").forEach((el) => {
    el.setAttribute("aria-label", fill(el.dataset.tLabel!));
  });
  const mod = MODULES[activeModule];
  $("pageTitle").textContent = mod.title;
  document.title = `${mod.title} · Finance Analytics`;
  const sheets = moduleData[activeModule]?.sheetNames || [];
  $("pageSub").textContent = sheets.length
    ? `Interactive analysis of the "${sheets.join('", "')}" sheet${sheets.length > 1 ? "s" : ""}`
    : "Interactive analysis from yearly Excel tables";

  document.querySelectorAll<HTMLElement>(".side-item[data-module]").forEach((btn) => {
    const on = btn.dataset.module === activeModule;
    btn.classList.toggle("active", on);
    if (on) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  document.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
    const key = el.dataset.count as ModuleKey;
    if (!MODULES[key]) return; // Market: market.ts
    const d = moduleData[key];
    el.textContent = d ? d.records.length.toLocaleString(CONFIG.locale) : "";
  });
}

// Rows left out while reading the active module, never dropped silently
function showSkipped(): void {
  const data = moduleData[activeModule];
  const skipped = data?.skipped;
  $("err").innerHTML = skipped?.count
    ? `<div class="notice">${skipped.count} row${skipped.count === 1 ? " was" : "s were"} skipped because the date or amount could not be read (for example ${esc(skipped.samples.join("; "))}). Dates written as text should look like 14-03-2025.</div>`
    : data && !data.records.length
      ? `<div class="notice">This workbook has no ${esc(MODULES[activeModule].title)} sheet with Date, Amount, Category and Mode headings.</div>`
      : "";
}

// Show another module: its records, its settings, its words
export function selectModule(key: ModuleKey): void {
  activeModule = key;
  showPage(null); // leave the Overview / Market page
  const d = moduleData[key];
  setAllRows(d ? d.records : []);
  setSettings(d ? d.settings : emptySettings());
  // A search typed on the other module's page means nothing here
  $<HTMLInputElement>("search").value = "";
  updateSearchClear();
  setupCurrency(); // fills `rows` with the chosen currency
  applyModuleTexts();
  showSkipped();
  rebuildAll();
}

export function setupModuleNav(): void {
  document.querySelectorAll<HTMLElement>(".side-item[data-module]").forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.module === activeModule && activePage !== "overview") return;
      selectModule(btn.dataset.module as ModuleKey);
      window.scrollTo({ top: 0 });
    };
  });
}
