/* =========================================================================
   filters.js
   The four filter dropdowns on the main dashboard (Years, Months,
   Categories, Modes) and the function that applies them to the data.
   The dropdowns come from filterGroup.js.
   ========================================================================= */

// The four dropdowns, built by buildFilters()
const dashFilters = createFilterGroup({
  prefix: "dash",
  onChange: () => {
    scrollTableToTop();
    render();
  },
});

// (Re)build all four dropdowns from the loaded data
function buildFilters() {
  dashFilters.init();
}

// A test "does this record pass every filter and the search box?", or
// null when some dropdown has nothing ticked (then nothing can pass).
// Built once per redraw; computeView() and current() share it.
function dashboardMatcher() {
  const years = dashFilters.years.set();
  const months = dashFilters.months.set();
  const cats = dashFilters.cats.set();
  const modes = dashFilters.modes.set();
  if (!years.size || !months.size || !cats.size || !modes.size) return null;

  // Leading/trailing spaces are ignored; an empty box skips the text test
  const query = $("search").value.trim().toLowerCase();
  const inFilters = (r) =>
    years.has(r.Year) &&
    cats.has(r.Category) &&
    modes.has(r.Mode) &&
    months.has(r.Month);
  return query ? (r) => inFilters(r) && r.Search.includes(query) : inFilters;
}

// Return the records that pass every filter and the search box.
// tableRows is already in table order, and filtering keeps that order.
function current() {
  const match = dashboardMatcher();
  return match ? tableRows.filter(match) : [];
}

// Show the x inside the search box only while it contains text
function updateSearchClear() {
  $("searchClear").hidden = $("search").value === "";
}

// Clicking a bar selects only that value in the matching filter
function applyBarFilter(key, value) {
  const name = {
    Year: "years",
    Month: "months",
    Category: "cats",
    Mode: "modes",
  }[key];
  if (name) dashFilters.checkOnly(name, value);
}

// The Reset button of the main dashboard
function resetDashboardFilters() {
  dashFilters.init();
  $("search").value = "";
  updateSearchClear();
  scrollTableToTop();
  render();
}
