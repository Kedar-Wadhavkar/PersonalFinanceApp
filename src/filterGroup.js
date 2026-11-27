/* =========================================================================
   filterGroup.js
   The four linked filters (Years, Months, Categories, Modes) that every
   section of the page has, plus the filter-bar HTML itself.

   Rules for the lists (the same in every section):
   - Years ........ newest first.
   - Months ....... Jan to Dec.
   - Categories ... only those that have spending in the ticked years and
                    months, biggest total first.
   - Modes ........ only those that have spending in the ticked years,
                    months and categories, biggest total first.
   When Years, Months or Categories change, the lists after them are
   rebuilt. The user's last choice in Categories / Modes is remembered and
   ticked again wherever it still exists ("all" stays "all").
   ========================================================================= */

// The four filters: key in the group, name used in element ids, caption
const FILTER_NAMES = [
  { key: "years", id: "Year", label: "Years" },
  { key: "months", id: "Month", label: "Months" },
  { key: "cats", id: "Cat", label: "Categories" },
  { key: "modes", id: "Mode", label: "Modes" },
];

// One prefix per section: dashboard, monthly comparison, category
// comparison, calendar, donuts
const FILTER_PREFIXES = ["dash", "my", "cy", "hm", "dn"];

/* ------------ Filter bar HTML ------------ */

// Element ids follow one pattern: <prefix><Year|Month|Cat|Mode><Multi|Menu|Toggle|Label>
function filterBarHtml(prefix, yearLabel) {
  const fields = FILTER_NAMES.map(({ id, label }) => {
    const p = prefix + id;
    const text = id === "Year" ? yearLabel : label;
    return (
      `<div class="field"><span class="small field-label" id="${p}Label">${text}</span>` +
      `<div id="${p}Multi" class="multi">` +
      `<button type="button" id="${p}Toggle" aria-labelledby="${p}Label ${p}Toggle">All selected ▾</button>` +
      `<div id="${p}Menu" class="multi-menu"></div></div></div>`
    );
  }).join("");
  return fields + `<button type="button" id="${prefix}Reset">Reset</button>`;
}

// Fill every <div data-filter-bar="prefix" [data-year-label="Year"]>
function buildFilterBars() {
  document.querySelectorAll("[data-filter-bar]").forEach((el) => {
    el.innerHTML = filterBarHtml(
      el.dataset.filterBar,
      el.dataset.yearLabel || "Years",
    );
  });
}

// Ids of the four dropdown containers of one section (for wireMultiToggles)
const filterMultiIds = (prefix) => FILTER_NAMES.map((f) => `${prefix}${f.id}Multi`);

buildFilterBars();

/* ------------ Ranking ------------ */

// Names of a Map(name -> total), biggest total first (ties: A-Z)
function sortedByTotal(totals) {
  return [...totals]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map((entry) => entry[0]);
}

/* ------------ The group ------------ */

/*
  options:
  - prefix ......... which filter bar (see FILTER_PREFIXES)
  - onChange(name) . called after the USER changes a dropdown
  - yearValues ..... function giving the years to list (default: catalog.years)
  - yearOptions .... extra createMultiSelect options for Years (limit, ...)
  - yearOf(record) . the year a record belongs to (default: record.Year)
  - fallback ....... when a remembered Categories/Modes choice no longer
                     exists in a rebuilt list: "all" ticks everything,
                     "top" ticks the first (biggest) item

  The returned object has the four dropdowns as group.years / .months /
  .cats / .modes (each with values(), set() ...), their item lists as
  group.items.<name>, and:
  - init(selection) ... build everything. `selection` may give years /
                        months / cats / modes lists to tick (default: the
                        starting selection). Does not call onChange.
  - checkOnly(name, value), resetOne(name) ... like the menu methods, but
                        also rebuild the lists that depend on that menu.
*/
function createFilterGroup({
  prefix,
  onChange,
  yearValues = () => catalog.years,
  yearOptions = {},
  yearOf = (r) => r.Year,
  fallback = "all",
}) {
  const group = { items: { years: [], months: [], cats: [], modes: [] } };
  const choice = { cats: "all", modes: "all" }; // "all" or a list of names

  const idsOf = (name) => {
    const p = prefix + FILTER_NAMES.find((f) => f.key === name).id;
    return { menuId: p + "Menu", toggleId: p + "Toggle", cls: p + "Check" };
  };

  // (Re)build one dropdown. ticked: "all" (starting selection) or a list.
  function build(name, values, ticked = "all", extra = {}) {
    group.items[name] = values;
    group[name] = createMultiSelect({
      ...idsOf(name),
      values,
      onChange: () => changed(name),
      ...extra,
    });
    if (ticked !== "all") group[name].setValues(ticked);
  }

  // What a Categories/Modes dropdown has ticked: "all" or the ticked items
  function ticks(name) {
    const picked = group[name].values();
    const count = group.items[name].length;
    return count && picked.length === count ? "all" : [...picked];
  }

  // What to tick in a rebuilt list, from the remembered choice
  function pick(name, list) {
    const wanted = choice[name];
    if (wanted === "all") return "all";
    if (!wanted.length && fallback !== "top") return []; // user cleared it
    const kept = list.filter((v) => wanted.includes(v));
    if (kept.length) return kept;
    return fallback === "top" && list.length ? [list[0]] : "all";
  }

  // Categories with spending in the ticked years + months, biggest first
  function rankedCategories() {
    const years = group.years.set();
    const months = group.months.set();
    const totals = new Map();
    for (const r of rows) {
      if (years.has(yearOf(r)) && months.has(r.Month)) {
        totals.set(r.Category, (totals.get(r.Category) || 0) + r.Amount);
      }
    }
    return sortedByTotal(totals);
  }

  // Modes with spending in the ticked years + months + categories
  function rankedModes() {
    const years = group.years.set();
    const months = group.months.set();
    const cats = group.cats.set();
    const totals = new Map();
    for (const r of rows) {
      if (years.has(yearOf(r)) && months.has(r.Month) && cats.has(r.Category)) {
        totals.set(r.Mode, (totals.get(r.Mode) || 0) + r.Amount);
      }
    }
    return sortedByTotal(totals);
  }

  function rebuildCategories() {
    const list = rankedCategories();
    build("cats", list, pick("cats", list));
  }

  function rebuildModes() {
    const list = rankedModes();
    build("modes", list, pick("modes", list));
  }

  // Rebuild the lists that come after the menu `name`
  function rebuildAfter(name) {
    if (name === "years" || name === "months") rebuildCategories();
    if (name !== "modes") rebuildModes();
  }

  // The user changed a dropdown
  function changed(name) {
    if (name === "cats" || name === "modes") choice[name] = ticks(name);
    rebuildAfter(name);
    onChange(name);
  }

  group.init = (selection = {}) => {
    build("years", yearValues(), selection.years ?? "all", yearOptions);
    build(
      "months",
      rows.length ? CONFIG.months : [],
      selection.months ?? "all",
    );
    choice.cats = selection.cats ?? "all";
    choice.modes = selection.modes ?? "all";
    rebuildCategories();
    rebuildModes();
  };

  // Tick only `value` (a bar was clicked). Does not call onChange.
  group.checkOnly = (name, value) => {
    group[name].checkOnly(value);
    if (name === "cats" || name === "modes") choice[name] = [String(value)];
    rebuildAfter(name);
  };

  // Put one dropdown back to its starting selection. Does not call onChange.
  group.resetOne = (name) => {
    if (name === "years" || name === "months") {
      group[name].reset();
      rebuildAfter(name);
      return;
    }
    choice[name] = "all";
    if (name === "cats") rebuildCategories();
    rebuildModes(); // Modes depends on Categories, and is itself reset here
  };

  return group;
}
