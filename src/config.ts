/* ========================================================
   config.ts
   Everything you are likely to change when you swap in your own data.
   ======================================================== */

export const CONFIG = {
  // --- Number formatting ---
  locale: "en-IN", // dates and percentages
  currency: "INR", // used until a workbook says otherwise
  // Number layout (digit grouping, e.g. 12,34,567) of every currency. To give
  // one currency its own layout: currencyLocales: { JPY: "ja-JP" }
  currencyLocales: {} as Record<string, string>,
  currencyLocaleDefault: "en-IN",
  // Symbols written in the Currency column / Settings sheet -> currency code
  // (a currency written as a code, e.g. "JPY", needs no entry)
  currencySymbols: {
    "₹": "INR",
    "¥": "JPY",
    "$": "USD",
    "€": "EUR",
    "£": "GBP",
    Rs: "INR",
    "Rs.": "INR",
  } as Record<string, string>,

  // --- Calendar ---
  months: [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ],

  // --- Charts ---
  // Width (px) of the value axis at the left of every chart, so all graph
  // areas start and end at the same place. Keep equal to --axis in main.css.
  chartAxisWidth: 48,

  // --- Comparison charts ---
  maxCompareYears: 5, // most years shown in a comparison chart
  compareCategoriesInView: 8, // categories visible at once; more = scroll
  // Bar colour per year (oldest -> newest, light -> dark), per chart
  yearColors: {
    monthly: ["#fde68a", "#fcd34d", "#fbbf24", "#f59e0b", "#d97706"], // yellow
    category: ["#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d"], // green
  } as Record<"monthly" | "category", string[]>,
  mutedColor: "#e2e8f0", // colour of bars that are not highlighted

  // --- Share of Expenditure (half donuts) ---
  donutColors: {
    selected: "#a78bfa", // soft violet
    outline: "#8b5cf6", // thin edge around the selected part
    others: "#ddd6fe", // lavender
    empty: "#e5e7eb", // grey: whole ring when nothing is selected
  },

  // --- Behaviour ---
  searchDebounceMs: 120, // delay before the search box re-filters
};

