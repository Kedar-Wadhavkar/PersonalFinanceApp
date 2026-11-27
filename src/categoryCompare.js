/* =========================================================================
   categoryCompare.js
   "Category-wise comparison": grouped bars, one group per category, one bar
   per year (up to CONFIG.maxCompareYears years). CONFIG.compareCategoriesInView
   categories fit the chart; more make it scroll sideways.

   Has its own filters that do NOT affect the main dashboard.
   The chart itself is drawn by charts.js.
   ========================================================================= */

// The four dropdowns of this section (built by setupCategoryYear)
const categoryFilters = createFilterGroup({
  prefix: "cy",
  yearOptions: {
    limit: CONFIG.maxCompareYears,
    headerLabel: `Latest ${CONFIG.maxCompareYears}`,
    latestOnly: true,
  },
  onChange: () => {
    highlight.category = null;
    renderCategoryYear();
  },
});

// Build the four dropdowns from the loaded data, then draw the chart
function setupCategoryYear() {
  categoryFilters.init();
  renderCategoryYear();
}

// The Reset button of this section
function resetCategoryYear() {
  categoryFilters.init();
  highlight.category = null;
  renderCategoryYear();
}

function renderCategoryYear() {
  const selectedYears = categoryFilters.years.values();
  const selectedCategories = categoryFilters.cats.values();
  const months = categoryFilters.months.set();
  const modes = categoryFilters.modes.set();

  // Years shown: ticked ones, newest N, drawn oldest -> newest
  const years = catalog.years
    .filter((y) => selectedYears.includes(y))
    .slice(0, CONFIG.maxCompareYears)
    .sort((a, b) => Number(a) - Number(b));

  if (!years.length || !selectedCategories.length || !months.size || !modes.size) {
    clearChart("categoryYearChart", "categoryYearLegend");
    return;
  }

  // Total amount for every category/year pair: sums[category][year].
  // (Object.create(null) so a category called "constructor" is safe.)
  const sums = Object.create(null);
  selectedCategories.forEach((c) => {
    sums[c] = {};
    years.forEach((y) => (sums[c][y] = 0));
  });

  const yearSet = new Set(years);
  rows.forEach((r) => {
    const perYear = sums[r.Category];
    if (
      perYear &&
      yearSet.has(r.Year) &&
      months.has(r.Month) &&
      modes.has(r.Mode)
    ) {
      perYear[r.Year] += r.Amount;
    }
  });

  // Biggest categories (over the years shown) first
  const total = (c) => years.reduce((s, y) => s + sums[c][y], 0);
  const categories = [...selectedCategories].sort(
    (a, b) => total(b) - total(a) || a.localeCompare(b),
  );

  drawGroupedBars({
    key: "category",
    chartId: "categoryYearChart",
    legendId: "categoryYearLegend",
    groups: categories,
    years,
    sums,
    longLabels: true,
  });
}
