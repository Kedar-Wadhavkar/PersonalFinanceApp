import { render } from "./dashboard";
import { createFilterGroup } from "./filterGroup";
import { tableRows } from "./state";
import { scrollTableToTop } from "./table";
import type { FilterName } from "./filterGroup";
import type { Transaction } from "./types";
import { $ } from "./utils";

/* =========================================================================
   filters.ts
   The four filter dropdowns on the main dashboard (Years, Months,
   Categories, Modes) and the function that applies them to the data.
   The dropdowns come from filterGroup.ts.
   ========================================================================= */

// The four dropdowns, built by buildFilters()
export const dashFilters = createFilterGroup({
  prefix: "dash",
  onChange: () => {
    scrollTableToTop();
    render();
  },
});

// (Re)build all four dropdowns from the loaded data
export function buildFilters(): void {
  dashFilters.init();
}

// A test "does this record pass every filter and the search box?", or
// null when some dropdown has nothing ticked (then nothing can pass).
// Built once per redraw; computeView() and current() share it.
export function dashboardMatcher(): ((r: Transaction) => boolean) | null {
  const years = dashFilters.years.set();
  const months = dashFilters.months.set();
  const cats = dashFilters.cats.set();
  const modes = dashFilters.modes.set();
  if (!years.size || !months.size || !cats.size || !modes.size) return null;

  // Leading/trailing spaces are ignored; an empty box skips the text test
  const query = $<HTMLInputElement>("search").value.trim().toLowerCase();
  const inFilters = (r: Transaction) =>
    years.has(r.Year) &&
    cats.has(r.Category) &&
    modes.has(r.Mode) &&
    months.has(r.Month);
  return query ? (r: Transaction) => inFilters(r) && r.Search.includes(query) : inFilters;
}

// Return the records that pass every filter and the search box.
// tableRows is already in table order, and filtering keeps that order.
export function current(): Transaction[] {
  const match = dashboardMatcher();
  return match ? tableRows.filter(match) : [];
}

// Show the x inside the search box only while it contains text
export function updateSearchClear(): void {
  $("searchClear").hidden = $<HTMLInputElement>("search").value === "";
}

// Clicking a bar selects only that value in the matching filter
export function applyBarFilter(key: string, value: string): void {
  const name = ({
    Year: "years",
    Month: "months",
    Category: "cats",
    Mode: "modes",
  } as Record<string, FilterName>)[key];
  if (name) dashFilters.checkOnly(name, value);
}

// The Reset button of the main dashboard
export function resetDashboardFilters(): void {
  dashFilters.init();
  $<HTMLInputElement>("search").value = "";
  updateSearchClear();
  scrollTableToTop();
  render();
}
