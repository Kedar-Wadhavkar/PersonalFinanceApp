/* =========================================================================
modules.js
The modules of the app (Expense, Income) and switching between them.

One workbook holds every module: each module reads its own sheet
("Expense", "Income") and its own settings sheet ("Expense_Settings",
"Income_Settings"). All pages share the same cards and code; a module only
changes WHICH records are shown and a few words ("spending" / "income").
========================================================================= */

const MODULES = {
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
const MODULE_KEYS = Object.keys(MODULES);

// The module shown now, and what the workbook gave each module
// (parseMatrices result: records, skipped, settings, settingsSheetName)
let activeModule = "expense";
const moduleData = { expense: null, income: null };

// Word of the active module: T("flow") -> "spending" / "income"
function T(key) {
  return MODULES[activeModule].text[key];
}

// Put the active module's words into the page:
// data-t="Daily {flow} calendar" -> "Daily income calendar"
function applyModuleTexts() {
  const fill = (pattern) => pattern.replace(/\{(\w+)\}/g, (m, k) => T(k));
  document.querySelectorAll("[data-t]").forEach((el) => {
    el.textContent = fill(el.dataset.t);
  });
  document.querySelectorAll("[data-t-label]").forEach((el) => {
    el.setAttribute("aria-label", fill(el.dataset.tLabel));
  });
  const mod = MODULES[activeModule];
  $("pageTitle").textContent = mod.title;
  document.title = `${mod.title} · Finance Analytics`;
  const sheets = moduleData[activeModule]?.sheetNames || [];
  $("pageSub").textContent = sheets.length
    ? `Interactive analysis of the "${sheets.join('", "')}" sheet${sheets.length > 1 ? "s" : ""}`
    : "Interactive analysis from yearly Excel tables";

  document.querySelectorAll(".side-item[data-module]").forEach((btn) => {
    const on = btn.dataset.module === activeModule;
    btn.classList.toggle("active", on);
    if (on) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  document.querySelectorAll("[data-count]").forEach((el) => {
    if (!MODULES[el.dataset.count]) return; // Market: market.js
    const d = moduleData[el.dataset.count];
    el.textContent = d ? d.records.length.toLocaleString(CONFIG.locale) : "";
  });
}

// Rows left out while reading the active module, never dropped silently
function showSkipped() {
  const skipped = moduleData[activeModule]?.skipped;
  $("err").innerHTML = skipped?.count
    ? `<div class="notice">${skipped.count} row${skipped.count === 1 ? " was" : "s were"} skipped because the date or amount could not be read (for example ${esc(skipped.samples.join("; "))}). Dates written as text should look like 14-03-2025.</div>`
    : moduleData[activeModule] && !moduleData[activeModule].records.length
      ? `<div class="notice">This workbook has no ${esc(MODULES[activeModule].title)} sheet with Date, Amount, Category and Mode headings.</div>`
      : "";
}

// Show another module: its records, its settings, its words
function selectModule(key) {
  activeModule = key;
  showPage(null); // leave the Overview / Market page
  const d = moduleData[key];
  allRows = d ? d.records : [];
  settings = d ? d.settings : emptySettings();
  // A search typed on the other module's page means nothing here
  $("search").value = "";
  updateSearchClear();
  setupCurrency(); // fills `rows` with the chosen currency
  applyModuleTexts();
  showSkipped();
  rebuildAll();
}

function setupModuleNav() {
  document.querySelectorAll(".side-item[data-module]").forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.module === activeModule && activePage !== "overview") return;
      selectModule(btn.dataset.module);
      window.scrollTo({ top: 0 });
    };
  });
}
