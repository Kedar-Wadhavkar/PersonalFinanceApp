import { setupCategoryYear } from "./categoryCompare";
import { computeKpis, render, renderKpis } from "./dashboard";
import { setupDonuts } from "./donuts";
import { buildFilters } from "./filters";
import { setupHeatmap } from "./heatmap";
import { setupLineChart } from "./lineChart";
import { setupMultiYear } from "./monthlyCompare";
import { refreshCatalog } from "./state";
import { scrollTableToTop, sortTableRows } from "./table";

/* =========================================================================
rebuild.ts
Redraws every section of a module page from the current `rows` (after a
workbook is loaded, the module changes, or another currency is picked).
========================================================================= */

export function rebuildAll(): void {
  refreshCatalog();
  sortTableRows();
  scrollTableToTop();
  buildFilters();

  computeKpis();
  renderKpis();
  render();
  setupMultiYear();
  setupCategoryYear();
  setupHeatmap();
  setupLineChart();
  setupDonuts();
}
