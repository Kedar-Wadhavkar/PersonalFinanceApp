import { CONFIG } from "./config";
import { rebuildAll } from "./rebuild";
import { MODULES, activeModule, moduleData } from "./modules";
import { nwState, renderNetWorth } from "./networth";
import { activePage, overviewState, renderOverview } from "./overview";
import { activeCurrency, allRows, setActiveCurrency, setRows, settings } from "./state";
import type { SettingsListKey } from "./types";
import { $, esc, setMoneyCurrency } from "./utils";

/* =========================================================================
   settings.ts
   Currency radio buttons in the header and the Settings pop-up.

   The settings themselves are read from the "Settings" sheet of the
   workbook (see parseSettings in excel.ts). The pop-up only SHOWS them;
   change them in Excel and load the file again.
   ========================================================================= */

// Lists shown in the pop-up: which list of `settings`, and its heading
const SETTINGS_SHOWN: [SettingsListKey, string][] = [
  ["currencies", "Currency"],
  ["ignoreColumns", "Ignore columns"],
  ["ignoreDates", "Ignore dates"],
  ["ignoreParticulars", "Ignore particulars"],
  ["ignoreCategories", "Ignore categories"],
  ["ignoreModes", "Ignore modes"],
];

/* ------------ Currency ------------ */

// Show only the records of one currency, everywhere on the page.
// The caller redraws (rebuildAll).
function applyCurrency(code: string): void {
  setActiveCurrency(code);
  setMoneyCurrency(code);
  setRows(allRows.filter((r) => r.Currency === code));
}

// "JPY" -> "¥": the symbol written for that currency (see CONFIG.currencySymbols);
// a currency without a symbol is shown by its code
export function currencySymbol(code: string): string {
  const symbol = Object.keys(CONFIG.currencySymbols).find(
    (s) => CONFIG.currencySymbols[s] === code,
  );
  return symbol || code;
}

// Fill the radio buttons after a workbook was loaded. The currencies are
// those of the Settings sheet (first = default); without a Settings sheet,
// those found in the data.
export function setupCurrency(): void {
  const found = [...new Set(allRows.map((r) => r.Currency))];
  const options = settings.currencies.length ? settings.currencies : found;
  // Keep the currency already shown when this module has it too
  const first = options.includes(activeCurrency) ? activeCurrency : options[0] || CONFIG.currency;
  const box = $("currency");

  box.innerHTML = options
    .map(
      (code) =>
        `<label class="cur-opt" title="${esc(code)}"><input type="radio" name="currency" value="${esc(code)}"${code === first ? " checked" : ""} aria-label="${esc(code)}"><span aria-hidden="true">${esc(currencySymbol(code))}</span></label>`,
    )
    .join("");
  box.hidden = options.length < 2; // nothing to choose from
  applyCurrency(first);
}

/* ------------ Pop-up ------------ */

// "2026-10-17" -> "17-10-2026" (the way dates are written in the workbook)
export const displayDate = (iso: string): string => iso.split("-").reverse().join("-");

function openSettingsDialog(): void {
  const shown = (key: SettingsListKey, value: string) => (key === "ignoreDates" ? displayDate(value) : value);

  const mod = MODULES[activeModule];
  const sheetName = moduleData[activeModule]?.settingsSheetName;
  $("settingsTitle").textContent = `${mod.title} settings`;
  $("settingsNote").textContent = settings.found
    ? `Read from the "${sheetName}" sheet of the workbook. Change them in Excel and load the file again.`
    : allRows.length
      ? `This workbook has no "${mod.settingsLabel}" sheet, so every row is read.`
      : `Load a workbook to see its "${mod.settingsLabel}" sheet.`;

  $("settingsBody").innerHTML = SETTINGS_SHOWN.map(([key, title]) => {
    const items = settings[key];
    const list = items.length
      ? `<ul>${items
          .map((v) => {
            const isDefault = key === "currencies" && v === items[0];
            const text = key === "currencies" ? `${currencySymbol(v)} ${v}` : shown(key, v);
            return `<li>${esc(text)}${isDefault ? ' <span class="small">(default)</span>' : ""}</li>`;
          })
          .join("")}</ul>`
      : '<div class="small">None</div>';
    return `<div class="settings-col"><b>${title}</b>${list}</div>`;
  }).join("");

  $<HTMLDialogElement>("settingsDialog").showModal();
}

export function setupSettings(): void {
  $("settingsBtn").onclick = openSettingsDialog;
  const dialog = $<HTMLDialogElement>("settingsDialog");
  $("settingsClose").onclick = () => dialog.close();
  // A click on the dark area around the box closes it (Esc also works)
  dialog.onclick = (e) => {
    if (e.target === dialog) dialog.close();
  };
  // Choosing another currency redraws the whole page
  $("currency").onchange = (e) => {
    const input = e.target as HTMLInputElement;
    if (input.name !== "currency") return;
    applyCurrency(input.value);
    if (activePage === "overview") {
      overviewState.month = null; // latest month of this currency
      renderOverview();
    } else if (activePage === "networth") {
      nwState.month = null;
      renderNetWorth();
    }
    else rebuildAll();
  };
}
