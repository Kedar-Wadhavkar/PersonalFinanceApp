/* =========================================================================
   monthlyCompare.js
   "Month-wise comparison": grouped bars, one group per month, one bar per
   year (up to CONFIG.maxCompareYears years).

   Has its own filters that do NOT affect the main dashboard.
   The chart itself is drawn by charts.js.
   ========================================================================= */

// The four dropdowns of this section (built by setupMultiYear)
const monthlyFilters = createFilterGroup({
  prefix: "my",
  yearOptions: {
    limit: CONFIG.maxCompareYears,
    headerLabel: `Latest ${CONFIG.maxCompareYears}`,
    latestOnly: true,
  },
  onChange: () => {
    highlight.monthly = null;
    renderMultiYear();
  },
});

// Build the four dropdowns from the loaded data, then draw the chart
function setupMultiYear() {
  monthlyFilters.init();
  renderMultiYear();
}

// The Reset button of this section
function resetMultiYear() {
  monthlyFilters.init();
  highlight.monthly = null;
  renderMultiYear();
}

function renderMultiYear() {
  const selectedYears = monthlyFilters.years.values();
  const selectedMonths = monthlyFilters.months.values();
  const categories = monthlyFilters.cats.set();
  const modes = monthlyFilters.modes.set();

  if (
    !selectedYears.length ||
    !selectedMonths.length ||
    !categories.size ||
    !modes.size
  ) {
    clearChart("multiYearChart", "multiYearLegend");
    return;
  }

  // Years shown: ticked ones, newest N, drawn oldest -> newest
  const years = catalog.years
    .filter((y) => selectedYears.includes(y))
    .slice(0, CONFIG.maxCompareYears)
    .sort((a, b) => Number(a) - Number(b));
  const months = CONFIG.months.filter((m) => selectedMonths.includes(m));

  // Total amount for every month/year pair: sums[month][year]
  const sums = {};
  months.forEach((m) => {
    sums[m] = {};
    years.forEach((y) => (sums[m][y] = 0));
  });

  const yearSet = new Set(years);
  const monthSet = new Set(months);
  rows.forEach((r) => {
    if (
      yearSet.has(r.Year) &&
      monthSet.has(r.Month) &&
      categories.has(r.Category) &&
      modes.has(r.Mode)
    ) {
      sums[r.Month][r.Year] += r.Amount;
    }
  });

  drawGroupedBars({
    key: "monthly",
    chartId: "multiYearChart",
    legendId: "multiYearLegend",
    groups: months,
    years,
    sums,
  });
}
