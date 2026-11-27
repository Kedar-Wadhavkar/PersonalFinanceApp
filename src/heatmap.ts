import { CONFIG } from "./config";
import { createFilterGroup } from "./filterGroup";
import { T } from "./modules";
import { catalog, rows } from "./state";
import type { Transaction } from "./types";
import { $, NO_DATA_HTML, esc, money } from "./utils";

/* =========================================================================
heatmap.ts
"Daily spending calendar": one year as 12 small month grids.
Each day is coloured by how much was spent that day. Weeks run from
Sunday (left column) to Saturday (right column).

- Has its own filters (Year, Months, Categories, Modes); they do NOT
affect the rest of the page.
- Only days with spending are buttons. Clicking one opens a pop-up with
that day's transactions (also following this section's filters).
========================================================================= */

// The colours themselves live in the CSS only (.heat-l0 ... .heat-l4), and
// the legend uses the same classes, so they are defined in one place.
const HEAT_LEVELS = 5;
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"]; // Sunday first

// Date formatters, made once (making one per day cell is slow):
// day tooltips ("Tue, 18 Mar 2025") and the pop-up title (long form)
const heatDayFormat = new Intl.DateTimeFormat(CONFIG.locale, {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const heatTitleFormat = new Intl.DateTimeFormat(CONFIG.locale, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

// Transactions of each drawn day: "2025-03-18" -> [records]
let heatDays = new Map<string, Transaction[]>();

/* ------------ Filters ------------ */

// The four dropdowns of this section (built by setupHeatmap).
// The calendar shows ONE year: picking another year replaces it.
const heatFilters = createFilterGroup({
  prefix: "hm",
  yearValues: () => catalog.dateYears,
  yearOf: (r) => r.Date.slice(0, 4),
  yearOptions: { limit: 1, headerLabel: "Latest", latestOnly: true },
  onChange: renderHeatmap,
});

export function setupHeatmap(): void {
  heatFilters.init();
  renderHeatmap();
}

// The Reset button of this section
export function resetHeatmap(): void {
  heatFilters.init();
  renderHeatmap();
}

/* ------------ Colour levels ------------ */

// Five upper limits so that roughly a fifth of the spending days falls in
// each colour (one huge day, like rent, does not make every other day pale)
export function heatLimits(totals: Iterable<number>): number[] {
    const sorted = [...totals].sort((a, b) => a - b);
    const at = (p: number) => sorted[Math.floor(p * (sorted.length - 1))]!;
    return [at(0.2), at(0.4), at(0.6), at(0.8), sorted[sorted.length - 1]!];
}

// Level 0-4 of an amount
export function heatLevel(value: number, limits: number[]): number {
    const i = limits.findIndex((limit) => value <= limit);
    return i === -1 ? limits.length - 1 : i;
}

/* ------------ Drawing ------------ */

const pad2 = (n: number): string => String(n).padStart(2, "0");

// Months per row right now. Set in CSS (--heat-cols: 6 on desktop, fewer on
// smaller screens), so the split below always matches what is on screen.
function heatCols(): number {
  const cols = parseInt(getComputedStyle($("heatmapLast")).getPropertyValue("--heat-cols"), 10);
  return cols > 0 ? cols : 6;
}

// Months per row used by the last draw (see relayoutHeatmap)
let drawnHeatCols = 0;

// After a resize: redraw only if the number of months per row changed
// (the last row must stay in #heatmapLast for the sticky filters)
export function relayoutHeatmap(): void {
  if (heatFilters.years && heatCols() !== drawnHeatCols) renderHeatmap();
}

function renderHeatmap(): void {
    const box = $("heatmap");
    const last = $("heatmapLast");
    const legend = $("heatmapLegend");
    last.innerHTML = "";
    const year = heatFilters.years.values()[0];
    const months = heatFilters.months.set();
    const cats = heatFilters.cats.set();
    const modes = heatFilters.modes.set();

    heatDays = new Map();
    if (!year || !months.size || !cats.size || !modes.size) {
        box.innerHTML = NO_DATA_HTML;
        legend.innerHTML = "";
        return;
    }

    // Group the matching transactions by day
    const prefix = year + "-";
    const dayTotal = new Map<string, number>();
    for (const r of rows) {
        if (
            r.Date.startsWith(prefix) &&
            months.has(r.Month) &&
            cats.has(r.Category) &&
            modes.has(r.Mode)
        ) {
            const list = heatDays.get(r.Date);
            if (list) list.push(r);
            else heatDays.set(r.Date, [r]);
            dayTotal.set(r.Date, (dayTotal.get(r.Date) || 0) + r.Amount);
        }
    }
    const limits = dayTotal.size ? heatLimits(dayTotal.values()) : [];

    const y = Number(year);
    const todayMs = new Date().setHours(0, 0, 0, 0); // days after today are not "no-spend" days

    // HTML of one month grid (m = 0 for January), with its figures under it:
    // total spent, number of transactions and number of days without spending
    // (days that have not come yet are not counted)
    const monthHtml = (m: number) => {
        const monthName = CONFIG.months[m];
        const firstWeekday = new Date(y, m, 1).getDay(); // 0 = Sunday
        const daysInMonth = new Date(y, m + 1, 0).getDate();

        let html = `<div class="heat-month"><div class="heat-month-name">${monthName}</div><div class="heat-grid">`;
        html += WEEKDAYS.map((d) => `<span class="heat-wd">${d}</span>`).join("");
        for (let i = 0; i < firstWeekday; i++) html += `<span></span>`;

        let monthTotal = 0;
        let monthCount = 0;
        let noSpendDays = 0;

        for (let d = 1; d <= daysInMonth; d++) {
        const date = `${year}-${pad2(m + 1)}-${pad2(d)}`;
        const nice = heatDayFormat.format(new Date(y, m, d));
        const total = dayTotal.get(date);

        if (total === undefined) {
            // No spending: plain box, not clickable
            if (new Date(y, m, d).getTime() <= todayMs) noSpendDays++;
            html += `<span class="heat-day heat-none" title="${esc(nice)} · ${T("none")}">${d}</span>`;
        } else {
            const count = heatDays.get(date)!.length;
            monthTotal += total;
            monthCount += count;
            const level = heatLevel(total, limits);
            const tip = `${nice} · ${money(total)} · ${count} transaction${count === 1 ? "" : "s"}`;
            html += `<button type="button" class="heat-day heat-l${level}" data-date="${date}" title="${esc(tip)}" aria-label="${esc(tip)}">${d}</button>`;
        }
        }
        html += `</div>`;

        // Figures under the month (not for a month that has not started yet)
        if (new Date(y, m, 1).getTime() <= todayMs) {
            const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
            html += `<div class="heat-month-foot"><div class="heat-month-total">${money(monthTotal)}</div><div>${plural(monthCount, "transaction")}</div><div>${plural(noSpendDays, T("noDay"))}</div></div>`;
        }
        return html + `</div>`;
    };

    // Split the chosen months into rows. Every row except the last goes in
    // #heatmap (inside the sticky zone, together with the filters); the last
    // row goes in #heatmapLast, so the filters are released where it begins.
    // With a single row, everything is in #heatmapLast (nothing sticks).
    // Rows are centred by CSS, so a half-full last row sits in the middle.
    const chosen: number[] = [];
    CONFIG.months.forEach((monthName, m) => {
        if (months.has(monthName)) chosen.push(m);
    });
    const cols = heatCols();
    drawnHeatCols = cols;
    const splitAt = (Math.ceil(chosen.length / cols) - 1) * cols;

    let html = `<div class="heat-year">${esc(year)}</div>`;
    if (splitAt > 0) {
        html += `<div class="heat-months">${chosen.slice(0, splitAt).map(monthHtml).join("")}</div>`;
    }
    box.innerHTML = html;
    last.innerHTML = chosen.slice(splitAt).map(monthHtml).join("");

    // Legend: lowest day, the five colours (hover for their range), highest
    if (!dayTotal.size) {
        legend.innerHTML = `<span class="small">No ${T("flow")} in this selection</span>`;
        return;
    }
    const lowest = Math.min(...dayTotal.values());
    let swatches = "";
    for (let i = 0; i < HEAT_LEVELS; i++) {
        const from = i === 0 ? lowest : limits[i - 1];
        const range = `${money(from)} – ${money(limits[i])}`;
        swatches += `<i class="heat-swatch heat-l${i}" title="${esc(range)}"></i>`;
    }
    legend.innerHTML =
        `<span class="small">${money(lowest)}</span>` +
        swatches +
        `<span class="small">${money(limits[limits.length - 1])}</span>`;
}

/* ------------ Pop-up with one day's transactions ------------ */

function openDayDialog(date: string): void {
    const list = [...(heatDays.get(date) || [])].sort(
        (a, b) => b.Amount - a.Amount,
    );
    if (!list.length) return;

    const [yy, mm, dd] = date.split("-").map(Number) as [number, number, number];
    $("dayDialogTitle").textContent = heatTitleFormat.format(new Date(yy, mm - 1, dd));
    const total = list.reduce((s, r) => s + r.Amount, 0);
    $("dayDialogSummary").textContent = `${list.length} transaction${list.length === 1 ? "" : "s"} · ${money(total)}`;

    $("dayDialogRows").innerHTML = list
        .map(
            (r) =>
                `<tr><td title="${esc(r.Particular)}">${esc(r.Particular)}</td><td title="${esc(r.Category)}">${esc(r.Category)}</td><td title="${esc(r.Mode)}">${esc(r.Mode)}</td><td>${money(r.Amount)}</td></tr>`,
        )
        .join("");

    const dialog = $<HTMLDialogElement>("dayDialog");
    dialog.querySelector(".day-dialog-body")!.scrollTop = 0;
    dialog.showModal();
}

export function setupHeatmapClicks(): void {
    // One click handler for the whole calendar (only coloured days are buttons)
    const onDayClick = (e: MouseEvent) => {
        const day = (e.target as Element).closest<HTMLElement>("button[data-date]");
        if (day) openDayDialog(day.dataset.date!);
    };
    $("heatmap").onclick = onDayClick;
    $("heatmapLast").onclick = onDayClick;

    const dialog = $<HTMLDialogElement>("dayDialog");
    $("dayDialogClose").onclick = () => dialog.close();
    // A click on the dark area around the box closes it (Esc also works)
    dialog.onclick = (e) => {
        if (e.target === dialog) dialog.close();
    };
}
