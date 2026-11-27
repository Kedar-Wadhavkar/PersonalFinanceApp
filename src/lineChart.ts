import { labelCanvas } from "./charts";
import { CONFIG } from "./config";
import { sortedByTotal } from "./filterGroup";
import { T } from "./modules";
import { createMultiSelect } from "./multiselect";
import { rows } from "./state";
import { $, NO_DATA_HTML, esc, money, moneyShort, tint } from "./utils";

/* =========================================================================
   lineChart.ts
   "Spending trend": a stock-style line chart of the spending of one
   category over time, with up to 3 categories to compare.

   - Time frames: 3M, YTD, 1Y, 3Y, 5Y, 10Y, Max. They end at the LAST date in
     the data. When the data is shorter than the frame, all of it is shown.
   - 3M is drawn as weekly totals, every other frame as monthly totals.
     The current (unfinished) month is drawn dashed.
   - Normalize (2 or 3 lines): every line is scaled to its own highest
     point, so a small category can be compared with a big one.
   - X axis: month names for short frames, years for long ones, with a small
     light tick at the start of every month (no labels).

   - Legend at the bottom, like the other charts: click an entry to keep
     that line; the others are shown in a light version of their own colour.

   Its own controls; they do NOT affect the rest of the page.
   ========================================================================= */

type LineRange = "3M" | "YTD" | "1Y" | "3Y" | "5Y" | "10Y" | "Max";

/** The buckets (weeks or months) of one time frame, see lineWindow(). */
interface LineWindow {
  mode: "week" | "month";
  t0: number;
  t1: number;
  count: number;
  clipped: boolean;
  bucketStart(i: number): number;
  bucketEnd(i: number): number;
  indexOf(t: number): number;
}

const LINE_RANGES: LineRange[] = ["3M", "YTD", "1Y", "3Y", "5Y", "10Y", "Max"];
const LINE_COLORS = ["#2563eb", "#ea580c", "#7c3aed"]; // blue, orange, purple
const LINE_MAX_SERIES = 3;
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const MONTHS_BACK: Partial<Record<LineRange, number>> = { "1Y": 12, "3Y": 36, "5Y": 60, "10Y": 120 };

// What the user has chosen. Kept when another workbook / currency is loaded
// (as far as those categories still exist).
const lineState: { cats: string[]; range: LineRange; normalize: boolean; focus: string | null } = {
  cats: [],
  range: "Max",
  normalize: false,
  focus: null,
};

// All categories of the loaded data, biggest total first
let lineCategories: string[] = [];

/* ------------ Dates ------------ */

// "2026-10-22" -> milliseconds (UTC midnight)
const isoMs = (iso: string): number => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

// Month number counted from year 0: year * 12 + month (0 = January)
const monthOf = (t: number): number => {
  const d = new Date(t);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};
const monthStartMs = (m: number): number => Date.UTC(Math.floor(m / 12), m % 12, 1);

// "22 Oct"
const dayText = (t: number): string => {
  const d = new Date(t);
  return `${d.getUTCDate()} ${CONFIG.months[d.getUTCMonth()]}`;
};

/* ------------ The period shown ------------ */

/*
  Work out the buckets (weeks or months) of a time frame.
  firstT / lastT: first date of the chosen categories, last date of the data.
  Returns { mode, t0, t1, count, clipped, bucketStart(i), bucketEnd(i),
  indexOf(t) }. The period is [t0, t1); bucket i is [bucketStart(i),
  bucketEnd(i)). `clipped`: the data starts later than the time frame asks.
*/
function lineWindow(range: LineRange, firstT: number, lastT: number): LineWindow {
  if (range === "3M") {
    // 13 weeks, counted back from the last date, so every week is complete
    const wanted = lastT - 90 * DAY_MS;
    const t0 = Math.max(firstT, wanted);
    const t1 = lastT + DAY_MS;
    return {
      mode: "week",
      t0,
      t1,
      count: Math.ceil((t1 - t0) / WEEK_MS),
      clipped: firstT > wanted,
      bucketStart: (i: number) => t0 + i * WEEK_MS,
      bucketEnd: (i: number) => Math.min(t0 + (i + 1) * WEEK_MS, t1),
      indexOf: (t: number) => Math.floor((t - t0) / WEEK_MS),
    };
  }

  // Whole calendar months, ending with the month of the last date
  const endMonth = monthOf(lastT);
  const firstMonth = monthOf(firstT);
  let wanted = firstMonth; // Max
  if (range === "YTD") wanted = Math.floor(endMonth / 12) * 12;
  else if (MONTHS_BACK[range]) wanted = endMonth - MONTHS_BACK[range] + 1;
  const startMonth = Math.max(firstMonth, wanted);
  const t0 = monthStartMs(startMonth);
  const t1 = monthStartMs(endMonth + 1);
  return {
    mode: "month",
    t0,
    t1,
    count: endMonth - startMonth + 1,
    clipped: range !== "Max" && firstMonth > wanted,
    bucketStart: (i: number) => monthStartMs(startMonth + i),
    bucketEnd: (i: number) => monthStartMs(startMonth + i + 1),
    indexOf: (t: number) => monthOf(t) - startMonth,
  };
}

/* ------------ Scale and labels ------------ */

// A round number at or above v (1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8 or 10 times
// a power of ten): close to v, so the line fills the chart, and a quarter of it
// is still a clean number for the grid lines
function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / power;
  const step = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find((s) => f <= s + 1e-9);
  return step! * power;
}

// X axis label candidates: one per month (or per year), centred on the part
// of it that is inside [t0, t1). Returns [{ t, text }].
function axisCandidates(t0: number, t1: number, byYear: boolean): { t: number; text: string }[] {
  const out: { t: number; text: string }[] = [];
  if (byYear) {
    const last = new Date(t1 - 1).getUTCFullYear();
    for (let y = new Date(t0).getUTCFullYear(); y <= last; y++) {
      const from = Math.max(t0, Date.UTC(y, 0, 1));
      const to = Math.min(t1, Date.UTC(y + 1, 0, 1));
      out.push({ t: (from + to) / 2, text: String(y) });
    }
    return out;
  }
  const last = monthOf(t1 - 1);
  for (let m = monthOf(t0); m <= last; m++) {
    const from = Math.max(t0, monthStartMs(m));
    const to = Math.min(t1, monthStartMs(m + 1));
    const first = m === monthOf(t0);
    // The year is written with the first label and with every January
    const text = CONFIG.months[m % 12] + (first || m % 12 === 0 ? ` ${Math.floor(m / 12)}` : "");
    out.push({ t: (from + to) / 2, text });
  }
  return out;
}

// Keep every k-th label (counted from the last one) with the smallest k that
// leaves no two labels touching. Each label: { x, w } (centre, width in px).
function thinLabels<L extends { x: number; w: number }>(labels: L[], gap = 8): L[] {
  for (let k = 1; k <= labels.length; k++) {
    const kept = labels.filter((_, i) => (labels.length - 1 - i) % k === 0);
    if (kept.every((c, i) => i === 0 || c.x - kept[i - 1]!.x >= (c.w + kept[i - 1]!.w) / 2 + gap)) {
      return kept;
    }
  }
  return labels.slice(-1);
}

/* ------------ Controls ------------ */


// Normalize box (only with 2+ lines) and the time frame buttons
function renderLineControls(): void {
  $("lcNormalizeWrap").hidden = lineState.cats.length < 2;
  $<HTMLInputElement>("lcNormalize").checked = lineState.normalize;
  $("lcRanges").innerHTML = LINE_RANGES.map(
    (r) =>
      `<button type="button" class="lc-range" data-range="${r}" aria-pressed="${r === lineState.range}">${r}</button>`,
  ).join("");
}

// One-time wiring of the controls (they are redrawn, their container is not)
export function setupLineChartEvents(): void {
  $<HTMLInputElement>("lcNormalize").onchange = (e) => {
    lineState.normalize = (e.target as HTMLInputElement).checked;
    renderLineChart();
  };
  $("lcRanges").onclick = (e) => {
    const button = (e.target as Element).closest<HTMLElement>("[data-range]");
    if (!button) return;
    lineState.range = button.dataset.range as LineRange;
    renderLineControls();
    renderLineChart();
  };
  // Legend: click a line to keep it (the others go light); click again to undo
  $("lineLegend").onclick = (e) => {
    const button = (e.target as Element).closest<HTMLElement>("[data-cat]");
    if (!button) return;
    const cat = button.dataset.cat!;
    lineState.focus = lineState.focus === cat ? null : cat;
    renderLineChart();
  };
}

// After a workbook (or currency) was loaded, and after a reset
export function setupLineChart(): void {
  const totals = new Map<string, number>();
  rows.forEach((r) => totals.set(r.Category, (totals.get(r.Category) || 0) + r.Amount));
  lineCategories = sortedByTotal(totals);

  // Starting choice: just the top category (or what the user had chosen, as
  // far as those categories still exist)
  const kept = lineState.cats.filter((c) => totals.has(c)).slice(0, LINE_MAX_SERIES);
  // The Categories dropdown: up to 3 categories at a time, listed biggest
  // total first. Ticking a 4th un-ticks the last listed one, which is the one
  // with the smallest total (see multiselect.ts).
  const menu = createMultiSelect({
    menuId: "lcCatMenu",
    toggleId: "lcCatToggle",
    cls: "lcCatCheck",
    values: lineCategories,
    limit: LINE_MAX_SERIES,
    headerLabel: "", // no "Top 3" box; just the x (clear) button
    onChange: () => {
      lineState.cats = menu.values();
      renderLineControls();
      renderLineChart();
    },
  });
  menu.setValues(kept.length ? kept : lineCategories.slice(0, 1));
  lineState.cats = menu.values();

  renderLineControls();
  renderLineChart();
}

/* ------------ Drawing ------------ */

export function renderLineChart(): void {
  const box = $("lineChart");
  if (!rows.length || !lineState.cats.length) {
    box.innerHTML = NO_DATA_HTML;
    $("lineLegend").innerHTML = "";
    return;
  }

  const cats = lineState.cats;
  const index = new Map(cats.map((c, i) => [c, i]));

  // First date of the chosen categories, last date of all the data
  let firstT = Infinity;
  let lastT = -Infinity;
  for (const r of rows) {
    const t = isoMs(r.Date);
    if (t > lastT) lastT = t;
    if (index.has(r.Category) && t < firstT) firstT = t;
  }
  const win = lineWindow(lineState.range, firstT, lastT);

  // Add up every category per week / month
  const values: number[][] = cats.map(() => new Array<number>(win.count).fill(0));
  for (const r of rows) {
    const s = index.get(r.Category);
    if (s === undefined) continue;
    const t = isoMs(r.Date);
    if (t < win.t0 || t >= win.t1) continue;
    values[s]![win.indexOf(t)]! += r.Amount;
  }
  const totals = values.map((v) => v.reduce((a, b) => a + b, 0)); // per category, in this period

  // The last month is dashed while it is not over yet
  const todayMs = new Date().setHours(0, 0, 0, 0);
  const partial = win.mode === "month" && win.t1 - DAY_MS > todayMs;

  // Scale: money, or - normalized - every line as a share of its own peak
  const normalized = lineState.normalize && cats.length > 1;
  const peaks = values.map((v) => Math.max(...v) || 1);
  const drawn = normalized ? values.map((v, s) => v.map((x) => x / peaks[s]!)) : values;
  const top = normalized ? 1 : niceMax(Math.max(...values.flat()));
  const gridText = [0, 0.25, 0.5, 0.75, 1].map((p) =>
    normalized ? `${p * 100}%` : p ? moneyShort(top * p) : "0",
  );

  // Geometry
  const W = Math.max(280, box.clientWidth || 700);
  const H = W < 520 ? 205 : 235;
  const axisW = CONFIG.chartAxisWidth; // the same in every chart
  const padT = 10;
  const padR = 0;
  const plotL = axisW;
  const plotW = W - plotL - padR;
  const base = H - 36; // y of the zero line
  const plotH = base - padT;
  const xOf = (t: number) => plotL + ((t - win.t0) / (win.t1 - win.t0)) * plotW;
  const yOf = (v: number) => base - (v / top) * plotH;

  // Where each week / month is drawn (its middle)
  const xs: number[] = [];
  for (let i = 0; i < win.count; i++) xs.push(xOf((win.bucketStart(i) + win.bucketEnd(i)) / 2));

  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="touch-action:pan-y" aria-hidden="true">`;

  // Grid lines and the values at their left
  [0, 0.25, 0.5, 0.75, 1].forEach((p, i) => {
    const y = base - p * plotH;
    svg += `<line x1="${plotL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e2e8f0"/>`;
    svg += `<text x="${plotL - 6}" y="${y}" dy="0.35em" text-anchor="end" font-size="10" font-family="IBM Plex Sans, Arial, sans-serif" fill="#64748b">${esc(gridText[i])}</text>`;
  });

  // Axis: a light tick at the start of every month, taller at every January
  // when the axis is labelled with years; no labels on the ticks
  const spanMonths = (win.t1 - win.t0) / (30.44 * DAY_MS);
  const byYear = spanMonths > 14;
  for (let m = monthOf(win.t0) + 1; monthStartMs(m) < win.t1; m++) {
    const x = xOf(monthStartMs(m));
    const january = m % 12 === 0 && byYear;
    svg += `<line x1="${x}" y1="${base}" x2="${x}" y2="${base + (january ? 8 : 4)}" stroke="${january ? "#94a3b8" : "#cbd5e1"}"/>`;
  }

  // Axis labels: months for short frames, years for long ones
  labelCanvas.font = "10.5px IBM Plex Sans, Arial";
  const candidates = axisCandidates(win.t0, win.t1, byYear)
    .map((c) => ({ x: xOf(c.t), text: c.text, w: labelCanvas.measureText(c.text).width }))
    .filter((c) => c.x - c.w / 2 >= 0 && c.x + c.w / 2 <= W);
  thinLabels(candidates).forEach((c) => {
    svg += `<text x="${c.x}" y="${base + 22}" text-anchor="middle" font-size="10.5" font-family="IBM Plex Sans, Arial, sans-serif" fill="#64748b">${esc(c.text)}</text>`;
  });

  // The kept line (legend click) is drawn last, on top; the others are light
  const focus = lineState.focus !== null && cats.includes(lineState.focus) ? lineState.focus : null;
  lineState.focus = focus;
  const shade = (s: number): string => (focus && cats[s] !== focus ? tint(LINE_COLORS[s]!, 0.62) : LINE_COLORS[s]!);
  const lineOrder = cats.map((_, s) => s).sort((a, b) => Number(cats[a] === focus) - Number(cats[b] === focus));

  // The lines (a single line also gets a light area under it)
  const points = (s: number) => drawn[s]!.map((v, i): [number, number] => [xs[i]!, yOf(v)]);
  const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  lineOrder.forEach((s) => {
    const pts = points(s);
    const color = shade(s);
    if (cats.length === 1 && pts.length > 1) {
      svg += `<path d="${path(pts)} L${pts[pts.length - 1]![0].toFixed(1)} ${base} L${pts[0]![0].toFixed(1)} ${base} Z" fill="${color}" fill-opacity="0.08"/>`;
    }
    const solid = partial && pts.length > 1 ? pts.slice(0, -1) : pts;
    if (solid.length > 1) {
      svg += `<path d="${path(solid)}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    if (partial && pts.length > 1) {
      svg += `<path d="${path(pts.slice(-2))}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4 3" stroke-linecap="round"/>`;
    }
    if (pts.length <= 40) {
      pts.forEach(([x, y], i) => {
        const open = partial && i === pts.length - 1;
        svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${open ? "#fff" : color}" stroke="${color}" stroke-width="1.5"/>`;
      });
    }
  });

  // Hover: a vertical line and a dot on every line (moved by the pointer)
  svg += `<g id="lcHover" style="display:none"><line y1="${padT}" y2="${base}" stroke="#94a3b8" stroke-dasharray="3 3"/>`;
  cats.forEach((_, s) => (svg += `<circle r="4" fill="${LINE_COLORS[s]}" stroke="#fff" stroke-width="1.5"/>`));
  svg += `</g></svg><div class="line-tip" id="lcTip" hidden></div>`;
  box.innerHTML = svg;
  box.setAttribute(
    "aria-label",
    `Line chart of ${cats.join(", ")}, ${win.mode === "week" ? "weekly" : "monthly"} ${T("flow")}, ${dayText(win.t0)} to ${dayText(win.t1 - DAY_MS)}`,
  );

  // Tooltip: the week / month under the pointer, with every line's amount
  const bucketText = (i: number) => {
    if (win.mode === "week") return `${dayText(win.bucketStart(i))} – ${dayText(win.bucketEnd(i) - DAY_MS)}`;
    const m = monthOf(win.bucketStart(i));
    return `${CONFIG.months[m % 12]} ${Math.floor(m / 12)}${partial && i === win.count - 1 ? " (so far)" : ""}`;
  };
  const hover = $("lcHover");
  const tip = $("lcTip");
  const svgEl = box.querySelector("svg")!;
  const show = (e: PointerEvent) => {
    const x = e.clientX - svgEl.getBoundingClientRect().left;
    let best = 0;
    xs.forEach((bx, i) => {
      if (Math.abs(bx - x) < Math.abs(xs[best]! - x)) best = i;
    });
    hover.style.display = "";
    const bx = String(xs[best]);
    const line = hover.firstChild as SVGLineElement;
    line.setAttribute("x1", bx);
    line.setAttribute("x2", bx);
    [...hover.querySelectorAll("circle")].forEach((c, s) => {
      c.setAttribute("cx", bx);
      c.setAttribute("cy", String(yOf(drawn[s]![best]!)));
    });
    tip.innerHTML =
      `<b>${esc(bucketText(best))}</b>` +
      cats
        .map(
          (c, s) =>
            `<div><i class="lc-dot" style="background:${LINE_COLORS[s]}"></i>${esc(c)}: ${esc(money(values[s]![best]))}${normalized ? ` <span class="small">(${Math.round((values[s]![best]! / peaks[s]!) * 100)}% of peak)</span>` : ""}</div>`,
        )
        .join("");
    tip.hidden = false;
    const at = xs[best]!;
    const left = at + 12 + tip.offsetWidth > W ? at - 12 - tip.offsetWidth : at + 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${padT}px`;
  };
  const hide = () => {
    hover.style.display = "none";
    tip.hidden = true;
  };
  svgEl.onpointermove = show;
  svgEl.onpointerdown = show;
  svgEl.onpointerleave = hide;
  svgEl.onpointercancel = hide;

  // Legend at the bottom, like the other charts: a round colour key and the
  // category, with its total in this period below. Click to keep that line;
  // the colour keys of the other lines go light.
  $("lineLegend").innerHTML = cats
    .map(
      (c, s) =>
        `<button type="button" class="legend-btn" data-cat="${esc(c)}" aria-pressed="${c === focus}"><span class="legend-name"><i class="legend-swatch" style="background:${shade(s)}"></i>${esc(c)}</span><span class="legend-value">${esc(money(totals[s]))}</span></button>`,
    )
    .join("");
}
