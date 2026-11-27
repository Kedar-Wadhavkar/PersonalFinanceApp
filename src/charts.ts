import { CONFIG } from "./config";
import { highlight } from "./state";

/** Which comparison chart: picks its geometry, colours and highlight slot. */
type ChartKey = "monthly" | "category";

/** sums[group][year] = total amount */
export type GroupedSums = Record<string, Record<string, number>>;

interface ChartGeometry {
  minWidth?: number;
  perGroup?: number;
  inView?: number;
  plotHeight: number;
  gap: number;
  minBar: number;
  maxBar: number;
  minRect: number;
  labelY: number;
}

interface GroupedBarsOptions {
  key: ChartKey;
  chartId: string;
  legendId: string;
  groups: string[];
  years: string[];
  sums: GroupedSums;
  longLabels?: boolean;
}
import { $, NO_DATA_HTML, esc, money, moneyShort, smoothPath, tint } from "./utils";

/* ======================================================================
   charts.ts
   Draws the grouped bar chart + legend shared by BOTH comparison
   sections (monthlyCompare.ts and categoryCompare.ts).

   A chart is a set of groups (months or categories); each group has one
   bar per year. Clicking a bar or a legend entry highlights that year.
   Values are written at the grid lines on the left (an axis that stays in
   place while the bars scroll sideways), and the total of every group (over
   the years shown) is written under its name.
   ====================================================================== */

// Pixel sizes of each chart. The two charts differ only in these numbers.
const CHART_GEOMETRY: Record<ChartKey, ChartGeometry> = {
  monthly: {
    minWidth: 1050,
    perGroup: 88, // width per month
    plotHeight: 190, // height of the bar area (top grid line to zero line)
    gap: 14, // space kept free inside a group
    minBar: 5,
    maxBar: 14,
    minRect: 3,
    labelY: 21, // distance of group labels below the zero line
  },
  category: {
    // Width follows the chart box: CONFIG.compareCategoriesInView groups
    // fill it, more groups make it scroll sideways (see drawGroupedBars)
    inView: CONFIG.compareCategoriesInView,
    plotHeight: 190,
    gap: 18,
    minBar: 6,
    maxBar: 18,
    minRect: 4,
    labelY: 22,
  },
};

// Group labels: 11px text, extra lines 13px apart
const LABEL_FONT = "11px IBM Plex Sans, Arial";
const LABEL_LINE = 13;

// The total under every group label, and the value labels at the grid lines
const TOTAL_FONT = "bold 10.5px IBM Plex Sans, Arial";
const TOTAL_GAP = 18; // from the last label line to the total

// Full month names for the month-wise chart labels (data keys stay "jan"...)
const FULL_MONTH_NAMES: Record<string, string> = {
  Jan: "January", Feb: "February", Mar: "March", Apr: "April",
  May: "May", Jun: "June", Jul: "July", Aug: "August",
  Sep: "September", Oct: "October", Nov: "November", Dec: "December",
};

// One shared canvas, used only to measure label widths
export const labelCanvas = document.createElement("canvas").getContext("2d")!;

/*
  Split a label into lines that each fit `maxWidth` pixels, so the FULL
  name is shown (no "..."). Lines break between words; a single word that is
  wider than `maxWidth` is broken between letters.
*/
function wrapLabel(text: string, maxWidth: number): string[] {
  labelCanvas.font = LABEL_FONT;
  const fits = (s: string) => labelCanvas.measureText(s).width <= maxWidth;
  const lines: string[] = [];
  let line = "";

  text.split(/\s+/).filter(Boolean).forEach((word) => {
    const joined = line ? line + " " + word : word;
    if (fits(joined)) {
      line = joined;
      return;
    }
    if (line) lines.push(line);
    // Word too wide on its own: cut it into pieces that fit
    line = "";
    for (const ch of word) {
      if (line && !fits(line + ch)) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

// Colour of the bar for year number `index`, honouring the highlight
function yearColor(key: ChartKey, year: string, index: number): string {
  if (highlight[key] && year !== highlight[key]) return CONFIG.mutedColor;
  const palette = CONFIG.yearColors[key]; // each chart has its own colours
  return palette[Math.min(index, palette.length - 1)]!;
}

// Show the "No data selected" message instead of a chart
export function clearChart(chartId: string, legendId: string): void {
  $(chartId).innerHTML = NO_DATA_HTML;
  $(legendId).innerHTML = "";
}

/*
  options:
    key ....... "monthly" or "category" (picks geometry + highlight slot)
    chartId, legendId ... ids of the chart and legend <div>s
    groups .... group names, left-to-right
    years ..... year strings, oldest first
    sums ...... sums[group][year] = total amount
    longLabels: true = shorten long group names and show the full name on hover
*/
export function drawGroupedBars({
  key,
  chartId,
  legendId,
  groups,
  years,
  sums,
  longLabels = false,
}: GroupedBarsOptions): void {
  const g = CHART_GEOMETRY[key];

  // A highlighted year that is no longer shown is forgotten
  if (highlight[key] && !years.includes(highlight[key])) highlight[key] = null;

  const max = Math.max(1, ...groups.flatMap((n) => years.map((y) => sums[n]![y]!)));
  const n = Math.max(groups.length, 1);

  // Total of every group over the years shown
  const totals = groups.map((name) => years.reduce((s, y) => s + sums[name]![y]!, 0));

  // What is written under group i: its total, or the highlighted year's value
  const totalValue = (i: number): number => {
    const year = highlight[key];
    return year ? sums[groups[i]!]![year]! : totals[i]!;
  };
  const totalTip = (i: number) =>
    `${groups[i]} ${highlight[key] || "total"}: ${money(totalValue(i))}`;

  // Value labels at the grid lines (0, 25, 50, 75, 100% of the tallest bar).
  // The axis has the same width in every chart.
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((p) => (p ? moneyShort(max * p) : "0"));
  const axisWidth = CONFIG.chartAxisWidth;

  // Width of the bars area (the box minus the axis)
  const boxWidth = $(chartId).clientWidth || 0;
  const visible = Math.max(0, boxWidth - axisWidth) || 900;
  labelCanvas.font = TOTAL_FONT;
  const widestTotal = Math.max(0, ...totals.map((t) => labelCanvas.measureText(money(t)).width));
  let width: number;
  if (g.inView) {
    // Up to `inView` groups fill the visible width; more groups keep that
    // group width and the chart scrolls sideways.
    // A group is never narrower than its longest single word (+8px), so on
    // small screens names wrap between words, not in the middle of a word;
    // nor narrower than its widest total.
    labelCanvas.font = LABEL_FONT;
    const longestWord = Math.max(
      0,
      ...groups.flatMap((name) =>
        name.split(/\s+/).map((w) => labelCanvas.measureText(w).width),
      ),
    );
    const perGroup = Math.max(
      visible / g.inView,
      Math.ceil(longestWord) + 8,
      Math.ceil(widestTotal) + 8,
    );
    width = n * perGroup <= visible ? visible : n * perGroup;
  } else {
    // Fill the visible width; below the minimum width (phones) the chart
    // keeps that width and scrolls sideways
    const perGroup = Math.max(g.perGroup ?? 0, Math.ceil(widestTotal) + 8);
    width = Math.max(visible, g.minWidth ?? 0, groups.length * perGroup);
  }
  const groupWidth = width / n;

  // Full label text of every group, wrapped to the group width (4px free
  // on each side so neighbouring labels never touch)
  const labelLines = groups.map((name) =>
    wrapLabel(key === "monthly" ? FULL_MONTH_NAMES[name] || name : name, groupWidth - 8),
  );
  const extraLines = Math.max(0, ...labelLines.map((l) => l.length - 1));

  // The picture is cut tight around what is drawn (no blank bands above the
  // top grid line or below the labels), so the spacing around the chart is
  // set by CSS alone and matches the daily spending calendar.
  const top = 7; // room for half of the top value label, so it is not cut
  const base = top + g.plotHeight; // y of the zero line
  // Totals sit under the last label line (which is lower when names wrap)
  const totalY = base + g.labelY + extraLines * LABEL_LINE + TOTAL_GAP;
  const height = totalY + 4;
  const barWidth = Math.min(
    g.maxBar,
    Math.max(g.minBar, (groupWidth - g.gap) / Math.max(years.length, 1)),
  );

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

  // Horizontal grid lines
  [0, 0.25, 0.5, 0.75, 1].forEach((p) => {
    const y = base - p * g.plotHeight;
    svg += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#e2e8f0"/>`;
  });

  // Behind the bars: the area under the curve of the highlighted year
  svg += `<g class="trend-back" pointer-events="none"></g>`;

  // Top of every bar, per year: tops[yearIndex][groupIndex] = [x, y]
  const tops: [number, number][][] = years.map(() => []);

  // One group of bars per name
  groups.forEach((name, gi) => {
    const centerX = gi * groupWidth + groupWidth / 2;
    const start = centerX - (years.length * barWidth) / 2;

    years.forEach((year, yi) => {
      const value = sums[name]![year]!;
      const barHeight = (value / max) * g.plotHeight;
      tops[yi]!.push([start + yi * barWidth + 1 + Math.max(g.minRect, barWidth - 2) / 2, base - barHeight]);
      svg += `<rect class="chart-bar" data-year="${esc(year)}" tabindex="0" role="button" aria-pressed="${highlight[key] === year}" aria-label="${esc(name)} ${esc(year)}: ${money(value)}. Press to highlight this year" x="${start + yi * barWidth + 1}" y="${base - barHeight}" width="${Math.max(g.minRect, barWidth - 2)}" height="${barHeight}" rx="2" fill="${yearColor(key, year, yi)}"><title>${esc(name)} ${esc(year)}: ${money(value)}</title></rect>`;
    });

    // Label: one <tspan> per line, first line at the usual label height
    const tooltip = longLabels ? `<title>${esc(name)}</title>` : "";
    const tspans = labelLines[gi]!
      .map((line, li) => `<tspan x="${centerX}" dy="${li ? LABEL_LINE : 0}">${esc(line)}</tspan>`)
      .join("");
    svg += `<text x="${centerX}" y="${base + g.labelY}" text-anchor="middle" font-size="11" font-family="IBM Plex Sans, Arial, sans-serif" fill="#475569">${tooltip}${tspans}</text>`;

    // Total of the group, under its label (same height in every group).
    // While a year is highlighted it shows that year's value instead.
    svg += `<text class="chart-total" data-i="${gi}" x="${centerX}" y="${totalY}" text-anchor="middle" font-size="10.5" font-weight="700" font-family="IBM Plex Sans, Arial, sans-serif" fill="#0f172a"><title>${esc(totalTip(gi))}</title>${esc(money(totalValue(gi)))}</text>`;
  });
  // In front of the bars: the curve and dots of the highlighted year
  svg += `<g class="trend-front" pointer-events="none"></g>`;
  svg += "</svg>";

  // The axis: its own picture, so it stays in place while the bars scroll
  let axis = `<svg width="${axisWidth}" height="${height}" viewBox="0 0 ${axisWidth} ${height}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`;
  [0, 0.25, 0.5, 0.75, 1].forEach((p, i) => {
    axis += `<text x="${axisWidth - 6}" y="${base - p * g.plotHeight}" dy="0.35em" text-anchor="end" font-size="10" font-family="IBM Plex Sans, Arial, sans-serif" fill="#64748b">${esc(gridValues[i])}</text>`;
  });
  axis += `<text class="chart-total-label" x="${axisWidth - 6}" y="${totalY}" text-anchor="end" font-size="10" font-family="IBM Plex Sans, Arial, sans-serif" fill="#64748b">${esc(highlight[key] || "Total")}</text>`;
  axis += "</svg>";

  // Legend: one clickable entry per year
  const legendHtml = years
    .map(
      (year, i) =>
        `<button class="legend-btn" data-year="${esc(year)}"><i class="legend-swatch" style="background:${yearColor(key, year, i)}"></i>${esc(year)}</button>`,
    )
    .join("");

  const chart = $(chartId);
  const legend = $(legendId);
  chart.innerHTML = `<div class="chart-axis">${axis}</div><div class="chart-scroll">${svg}</div>`;
  legend.innerHTML = legendHtml;

  // The highlighted year: a curve joining the tops of its bars, in a lighter
  // shade of the bar colour, with a flat light fill of the same colour under it (like the
  // lists at the top of the page). Nothing is drawn when no year is highlighted.
  const trendBack = chart.querySelector(".trend-back")!;
  const trendFront = chart.querySelector(".trend-front")!;
  const drawTrend = () => {
    const year = highlight[key];
    const yi = year ? years.indexOf(year) : -1;
    if (yi < 0 || groups.length < 2) {
      trendBack.innerHTML = "";
      trendFront.innerHTML = "";
      return;
    }
    const pts = tops[yi]!;
    const barColor = yearColor(key, year!, yi);
    const lineColor = tint(barColor, 0.5); // a lighter shade of the bar colour
    const curve = smoothPath(pts, 0.12); // only a slight bend
    const [x0] = pts[0]!;
    const [x1] = pts[pts.length - 1]!;
    trendBack.innerHTML = `<path d="${curve} L${x1.toFixed(1)} ${base} L${x0.toFixed(1)} ${base} Z" fill="${barColor}" fill-opacity="0.15"/>`;
    trendFront.innerHTML =
      `<path d="${curve}" fill="none" stroke="${lineColor}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>` +
      pts
        .map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="#fff" stroke="${lineColor}" stroke-width="1.2"/>`)
        .join("");
  };
  drawTrend();

  // Click a bar or legend entry: highlight that year (click again to undo).
  // Only the colours and the figures under the names change, so they are
  // updated in place - no re-adding of the records, no rebuilding of the chart.
  const toggleYear = (year: string) => {
    highlight[key] = highlight[key] === year ? null : year;
    // The figures under the names follow: the highlighted year, or the total
    chart.querySelectorAll<SVGTextElement>(".chart-total").forEach((el) => {
      const i = Number(el.dataset.i);
      el.firstChild!.textContent = totalTip(i); // the <title> (hover text)
      el.lastChild!.nodeValue = money(totalValue(i));
    });
    const label = chart.querySelector(".chart-total-label");
    if (label) label.textContent = highlight[key] || "Total";
    const colorOf = (y: string) => yearColor(key, y, years.indexOf(y));
    chart.querySelectorAll<SVGRectElement>(".chart-bar").forEach((bar) => {
      bar.setAttribute("fill", colorOf(bar.dataset.year!));
      bar.setAttribute("aria-pressed", String(highlight[key] === bar.dataset.year));
    });
    legend.querySelectorAll<HTMLElement>(".legend-btn").forEach((button) => {
      button.querySelector<HTMLElement>(".legend-swatch")!.style.background = colorOf(button.dataset.year!);
    });
    drawTrend();
  };
  chart.onclick = (e) => {
    const bar = (e.target as Element).closest<SVGElement>(".chart-bar");
    if (bar) toggleYear(bar.dataset.year!);
  };
  // Keyboard: Enter or Space on a focused bar does the same as a click
  chart.onkeydown = (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const bar = (e.target as Element).closest<SVGElement>(".chart-bar");
    if (!bar) return;
    e.preventDefault(); // Space must not scroll the page
    toggleYear(bar.dataset.year!);
  };
  legend.onclick = (e) => {
    const button = (e.target as Element).closest<HTMLElement>(".legend-btn");
    if (button) toggleYear(button.dataset.year!);
  };
}
