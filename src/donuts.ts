import { CONFIG } from "./config";
import { createFilterGroup } from "./filterGroup";
import { catalog, rows } from "./state";
import type { FilterName, FilterSelection } from "./filterGroup";
import type { GroupField, Totals, Transaction } from "./types";
import { $, NO_DATA_HTML, esc, money } from "./utils";

interface DonutDefinition {
  key: FilterName;
  title: string;
  field: GroupField;
}

type DonutPart = "selected" | "others";

/* =========================================================================
   donuts.ts
   "Share of Expenditure": four half donuts in a chain
   (Year -> Month -> Category -> Mode). Each donut shows how much of the
   one before it is taken by what is ticked in its own dropdown.

   Filters (from filterGroup.ts):
   - Years and Months list everything (years newest first, months Jan-Dec).
   - Categories lists only the categories that have spending in the ticked
     years + months, biggest first. Modes lists only the modes that have
     spending in the ticked years + months + categories, biggest first.
   - Starting choice, right after loading (and on Reset): the current
     month and year, or - if it has no spending - the latest earlier month
     that has; then the top category of that month and its top mode.
     After that the menus keep whatever the user picks. If a remembered
     Category/Mode choice does not exist in a new period, the top item of
     the new list is ticked instead.

   This section's filters do NOT affect the rest of the page.
   ========================================================================= */

// The four donuts, in chain order
const DONUTS: DonutDefinition[] = [
  { key: "years", title: "Year", field: "Year" },
  { key: "months", title: "Month", field: "Month" },
  { key: "cats", title: "Category", field: "Category" },
  { key: "modes", title: "Mode", field: "Mode" },
];

// The four dropdowns of this section (built by applyDonutDefaults)
const donutFilters = createFilterGroup({
  prefix: "dn",
  fallback: "top",
  onChange: () => {
    resetDonutActive(); // new figures: every centre shows "Selected" again
    renderDonuts();
  },
});

/* --------- Starting choice --------- */

// Name with the biggest total in a Map(name -> total). ("" if empty).
export function topOf(map: Totals): string {
  let best = "";
  let bestTotal = -Infinity;
  map.forEach((total, name) => {
    if (total > bestTotal) {
      best = name;
      bestTotal = total;
    }
  });
  return best;
}

// Sum of the amounts of the records passing `test`, grouped by `field`
export function totalsBy(field: GroupField, test: (r: Transaction) => boolean): Totals {
  const totals: Totals = new Map();
  for (const r of rows) {
    if (test(r)) totals.set(r[field], (totals.get(r[field]) || 0) + r.Amount);
  }
  return totals;
}

// The starting selection: { years, months, cats, modes } (lists of names)
export function donutDefaults(): FilterSelection {
  if (!rows.length) return {};

  // Walk back from today's month to the first month that has spending
  const periods = new Set(rows.map((r) => `${r.Year}|${r.Month}`));
  const oldest = Number(catalog.years[catalog.years.length - 1]);
  const today = new Date();
  let y = today.getFullYear();
  let m = today.getMonth();
  while (y >= oldest && !periods.has(`${y}|${CONFIG.months[m]}`)) {
    if (--m < 0) {
      m = 11;
      y--;
    }
  }
  if (y < oldest) {
    // Nothing on or before today: latest year in the data, current month
    y = Number(catalog.years[0]);
    m = today.getMonth();
  }
  const year = String(y);
  const month = CONFIG.months[m]!;

  const inPeriod = (r: Transaction) => r.Year === year && r.Month === month;
  const topCategory = topOf(totalsBy("Category", inPeriod));
  const topMode = topCategory
    ? topOf(totalsBy("Mode", (r) => inPeriod(r) && r.Category === topCategory))
    : "";
  return {
    years: [year],
    months: [month],
    cats: topCategory ? [topCategory] : [],
    modes: topMode ? [topMode] : [],
  };
}

function applyDonutDefaults(): void {
  resetDonutActive(); // every centre starts on "Selected"
  donutFilters.init(donutDefaults());
}

// After a file is loaded
export function setupDonuts(): void {
  setupDonutClicks();
  applyDonutDefaults();
  renderDonuts();
}

// The Reset button of this section: back to the starting choice
export function resetDonuts(): void {
  applyDonutDefaults();
  renderDonuts();
}

/* --------- Layout (sticky filters) --------- */

// Donuts per row right now. Set in CSS (--donut-cols: 4, 2 on phones).
function donutCols(): number {
  const cols = parseInt(getComputedStyle($("donutsLast")).getPropertyValue("--donut-cols"), 10);
  return cols > 0 ? cols : 4;
}

// Donuts per row used by the last draw (see relayoutDonuts)
let drawnDonutCols = 0;

// After a resize: redraw only if the number of donuts per row changed
// (the last row must stay in #donutsLast for the sticky filters)
export function relayoutDonuts(): void {
  if (donutFilters.years && donutCols() !== drawnDonutCols) renderDonuts();
}

/* --------- Drawing one half donut --------- */

// Size of the picture (viewBox units; the SVG scales to the card width)
const DONUT_SIZE = { width: 200, height: 104, cx: 100, cy: 100, outer: 92, inner: 58 };

// Point on a circle of radius r at fraction t of the half circle
// (t = 0: left end, t = 0.5: top, t = 1: right end)
export function arcPoint(r: number, t: number): [number, number] {
  const angle = Math.PI * (1 - t);
  const { cx, cy } = DONUT_SIZE;
  return [cx + r * Math.cos(angle), cy - r * Math.sin(angle)];
}

// SVG path of the ring piece from fraction t0 to t1 (left -> right over
// the top). Never more than half a circle, so the "large arc" flag is 0.
export function ringPath(t0: number, t1: number): string {
  const { outer, inner } = DONUT_SIZE;
  const f = (n: number) => n.toFixed(2);
  const [x0, y0] = arcPoint(outer, t0);
  const [x1, y1] = arcPoint(outer, t1);
  const [x2, y2] = arcPoint(inner, t1);
  const [x3, y3] = arcPoint(inner, t0);
  return (
    `M${f(x0)} ${f(y0)} A${outer} ${outer} 0 0 1 ${f(x1)} ${f(y1)} ` +
    `L${f(x2)} ${f(y2)} A${inner} ${inner} 0 0 0 ${f(x3)} ${f(y3)} Z`
  );
}

// Text for what a dropdown has ticked: "None", "All", "2026", "3 of 6"
function donutChoiceText(name: FilterName): string {
  const picked = donutFilters[name].values();
  if (!picked.length) return "None";
  if (picked.length === donutFilters.items[name].length) return "All";
  if (picked.length === 1) return picked[0]!;
  return `${picked.length} of ${donutFilters.items[name].length}`;
}

// "18.4%" (one shared formatter; making one per call is slow)
const percentFormat = new Intl.NumberFormat(CONFIG.locale, {
  style: "percent",
  maximumFractionDigits: 1,
});
const percentText = (share: number): string => percentFormat.format(share);

/*
// The items each part of a donut, for the hover text:
// selected ... the ticked items
// others ... the items in the dropdown's list that are NOT ticked
// Listed in the order of the dropdowns: years newest first, months
// Jan -> Dec, categories and modes biggest first.
*/
function donutItemLists(name: FilterName): { selected: string; others: string } {
  const picked = donutFilters[name].set();
  const items = donutFilters.items[name];
  // One item per line (a stacked list in the tooltip)
  const list = (arr: string[]) => (arr.length ? arr.join("\n") : "(none)");
  return {
    selected: list(items.filter((v) => picked.has(v))),
    others: list(items.filter((v) => !picked.has(v))),
  };
}

/* --------- Clicking a part of a donut --------- */

// Which part each donut shows in its centre: "selected" (the default) or
// "others". Clicking a part switches it. Any filter change goes back to
// "selected" (see onDonutFilterChange / applyDonutDefaults).
const donutActive: Partial<Record<FilterName, DonutPart>> = {};

// The figures of the last draw, per donut, so a click only redraws that
// donut – no pass over the records
const donutFigures: Partial<
  Record<FilterName, { selected: number; total: number; noSelection: boolean }>
> = {};

// Back to the default (selected part shown) for every donut
function resetDonutActive(): void {
  DONUTS.forEach((d) => (donutActive[d.key] = "selected"));
}

// Redraw one donut after one of its parts was clicked
function showDonutPart(key: FilterName, part: DonutPart): void {
  donutActive[key] = part;
  const d = DONUTS.find((x) => x.key === key);
  const f = donutFigures[key];
  const old = document.querySelector(`.donut[data-key="${key}"]`);
  if (!d || !f || !old) return;
  old.outerHTML = donutHtml(d, f.selected, f.total, f.noSelection);
  // Keyboard users keep their place: focus the part they chose
  document.querySelector<SVGElement>(`.donut[data-key="${key}"] [data-part="${part}"]`)?.focus();
}

// One click / key handler per container (not one per part)
function setupDonutClicks(): void {
  const pick = (e: Event) => {
    const part = (e.target as Element).closest<SVGElement>("[data-part]");
    if (!part) return;
    const donut = part.closest<HTMLElement>(".donut")!;
    showDonutPart(donut.dataset.key as FilterName, part.dataset.part as DonutPart);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      if (!(e.target as Element).closest("[data-part]")) return;
      e.preventDefault(); // Space must not scroll the page
      pick(e);
    }
  };
  ["donuts", "donutsLast"].forEach((id) => {
    $(id).onclick = pick;
    $(id).onkeydown = onKey;
  });
}

/*
// HTML of one donut (title, picture).
// noSelection: true = grey ring (this menu, or one before it, has nothing
// ticked), not clickable. Every case has the same height.
// The two parts are buttons: the centre shows the share and amount of the
// active one (donutActive), which also gets the outline.
*/
function donutHtml(d: DonutDefinition, selected: number, total: number, noSelection: boolean): string {
  const C = CONFIG.donutColors;
  const choice = donutChoiceText(d.key);
  const lists = donutItemLists(d.key);
  const active = donutActive[d.key] === "others" ? "others" : "selected";

  // Hover texts: a heading line, then the items stacked one per line.
  // No amounts here – they are already shown on the card.
  const tipSel = `Selected:\n${lists.selected}`;
  const tipRest = noSelection
    ? `Nothing selected\nAvailable:\n${lists.others}`
    : `Others:\n${lists.others}`;

  // Top right: what is ticked (hover: the selected list). While the "others"
  // part is shown, it says "Others" instead (hover: the others list).
  const showOthers = active === "others" && !noSelection;
  const headText = showOthers ? "Others" : choice;
  const headTip = showOthers ? tipRest : tipSel;
  const head = `<div class="donut-head"><b>${d.title}</b><span class="small" title="${esc(headTip)}">${esc(headText)}</span></div>`;

  const others = total - selected;
  // Refunds are negative amounts, so a part can be below zero or above the
  // whole (a category of refunds: share -0.2). The ring is drawn with the
  // share kept within 0..1, or the arc would run off the half circle.
  const rawShare = total ? selected / total : 0;
  const share = Number.isFinite(rawShare) ? Math.min(1, Math.max(0, rawShare)) : 0;
  const { width, height, cx, cy } = DONUT_SIZE;

  // One clickable part. The active one gets the outline. Keyboard: Tab to
  // it, Enter or Space to show it (see setupDonutClicks).
  const partPath = (part: DonutPart, t0: number, t1: number, fill: string, tip: string) => {
    const on = part === active;
    const label = part === "selected" ? "Show selected" : "Show others";
    const edge = on ? ` stroke="${C.outline}" stroke-width="1.2" stroke-linejoin="round"` : "";
    return `<path class="donut-part${on ? " is-active" : ""}" data-part="${part}" d="${ringPath(t0, t1)}" fill="${fill}"${edge} tabindex="0" role="button" aria-pressed="${on}" aria-label="${label}"><title>${esc(tip)}</title></path>`;
  };

  // Centre: what the active part holds (grey: nothing)
  let label: string;
  let centreShare: number;
  let centreAmount: number;
  if (noSelection) {
    label = "Nothing selected";
    centreShare = 0;
    centreAmount = 0;
  } else if (active === "others") {
    label = ""; // "Others" is written top right, next to the title
    centreShare = total ? others / total : 0;
    centreAmount = others;
  } else {
    // The normal view: no label line
    label = "";
    centreShare = rawShare; // the true share, even below 0 or above 100%
    centreAmount = selected;
  }

  // Screen readers get the figures too (they cannot see the card)
  const spoken = noSelection
    ? `${d.title}: nothing selected`
    : `${d.title}: ${choice}. Selected ${money(selected)}, ${percentText(rawShare)}. Others ${money(others)}`;
  // role="group" (not "img"): the picture contains buttons
  let svg = `<svg viewBox="0 0 ${width} ${height}" role="group" aria-label="${esc(spoken)}">`;
  if (noSelection) {
    // Grey: nothing selected (not clickable)
    svg += `<path d="${ringPath(0, 1)}" fill="${C.empty}"><title>${esc(tipRest)}</title></path>`;
  } else {
    // others (lavender): from the end of the selected part to the right
    // end; the whole ring when the selection has no spending (0%)
    if (share < 1) svg += partPath("others", share, 1, C.others, tipRest);
    // Selected (violet): from the left end. Drawn last, so its outline is
    // not covered by the others part.
    if (share > 0) svg += partPath("selected", 0, share, C.selected, tipSel);
  }
  // In the middle: a label line only for "Nothing selected", then the share
  // (large) and the amount
  if (label) {
    svg += `<text x="${cx}" y="${cy - 41}" text-anchor="middle" class="donut-label">${label}</text>`;
  }
  svg += `<text x="${cx}" y="${cy - 20}" text-anchor="middle" class="donut-share">${percentText(centreShare)}</text>`;
  svg += `<text x="${cx}" y="${cy - 3}" text-anchor="middle" class="donut-amount">${esc(money(centreAmount))}</text>`;
  svg += `</svg>`;

  return `<div class="donut" data-key="${d.key}">${head}${svg}</div>`;
}

/* ------- Main render ------- */

function renderDonuts(): void {
  const box = $("donuts");
  const last = $("donutsLast");

  // No file loaded yet: one message for the card
  if (!rows.length) {
    box.innerHTML = NO_DATA_HTML;
    last.innerHTML = "";
    return;
  }

  const years = donutFilters.years.set();
  const months = donutFilters.months.set();
  const cats = donutFilters.cats.set();
  const modes = donutFilters.modes.set();

  // One pass down the chain. totals[i] = whole of donut i,
  // selected[i] = its violet part = totals[i + 1].
  const totals = [0, 0, 0, 0];
  const selected = [0, 0, 0, 0];
  for (const r of rows) {
    const a = r.Amount;
    totals[0] += a;
    if (!years.has(r.Year)) continue;
    selected[0] += a;
    totals[1] += a;
    if (!months.has(r.Month)) continue;
    selected[1] += a;
    totals[2] += a;
    if (!cats.has(r.Category)) continue;
    selected[2] += a;
    totals[3] += a;
    if (!modes.has(r.Mode)) continue;
    selected[3] += a;
  }

  // Grey from the first menu with nothing ticked onwards
  const sizes = [years.size, months.size, cats.size, modes.size];
  const firstEmpty = sizes.findIndex((n) => n === 0);
  const items = DONUTS.map((d, i) => {
    const noSelection = firstEmpty !== -1 && i >= firstEmpty;
    // Remembered so a click on a part redraws only that donut
    donutFigures[d.key] = { selected: selected[i], total: totals[i], noSelection };
    return donutHtml(d, selected[i], totals[i], noSelection);
  });

  // Every row except the last goes inside the sticky zone (with the
  // filters); the last row goes in #donutsLast, where the filters let go.
  // With a single row (4 donuts on desktop), nothing sticks.
  const cols = donutCols();
  drawnDonutCols = cols;
  const splitAt = (Math.ceil(items.length / cols) - 1) * cols;
  box.innerHTML =
    splitAt > 0 ? `<div class="donut-row">${items.slice(0, splitAt).join("")}</div>` : "";
  last.innerHTML = items.slice(splitAt).join("");
}
