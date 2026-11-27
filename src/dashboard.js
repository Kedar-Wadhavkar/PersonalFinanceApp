/* ========================================================
   dashboard.js
   The main dashboard: KPI cards and the four bar lists (with their sort
   menus). The transactions table lives in table.js.

   render() is the entry point. Call it after any filter change:
     computeView() ... filter the records and total them (ONE pass)
     renderSummary() ... KPI cards + the four bar lists
     renderTable() ... the transactions table (table.js)
   ======================================================== */

/* --------- Sort menus on the four bar-list cards --------- */

// Which "sort by" choices each list offers
function sortChoices(kind) {
  if (kind === "year" || kind === "month") {
    return [
      ["time", "Time"],
      ["amount", "Amount"],
    ];
  }
  return [
    ["name", "Name"],
    ["amount", "Amount"],
  ];
}

// Draw one sort menu with a tick next to the current choices
function paintSortMenu(wrap) {
  const kind = wrap.dataset.sort;
  const state = upperSort[kind];
  const dirChoices = [
    ["asc", "Ascending"],
    ["desc", "Descending"],
  ];
  const menu = wrap.querySelector(".sortmenu");

  const item = (field, value, label) =>
    `<button class="sortitem" data-set="${field}" data-val="${value}"><span class="sortcheck">${state[field] === value ? "✓" : ""}</span><span class="sortlabel">${label}</span></button>`;

  menu.innerHTML =
    sortChoices(kind)
      .map(([v, l]) => item("by", v, l))
      .join("") +
    '<div class="sortsep"></div>' +
    dirChoices.map(([v, l]) => item("dir", v, l)).join("");

  menu.querySelectorAll(".sortitem").forEach((b) => {
    b.onclick = () => {
      state[b.dataset.set] = b.dataset.val;
      paintSortMenu(wrap);
      drawList(kind); // only this list changes, nothing else needs redrawing
    };
  });
}

// Wire the sort buttons. Closing the other open menus is done in one place:
// the document click handler in main.js.
function setupUpperSort() {
  document.querySelectorAll(".sortwrap").forEach((wrap) => {
    paintSortMenu(wrap);
    const icon = wrap.querySelector(".sorticon");
    icon.setAttribute("aria-haspopup", "true");
    icon.setAttribute("aria-expanded", "false");
    icon.onclick = () => setMenuOpen(wrap, !wrap.classList.contains("open"));
  });
}

// The x next to the sort button puts that card's filter back to its starting selection
// (data-reset says which one: years, months, cats or modes)
function setupBarFilterResets() {
  document.querySelectorAll(".clearicon").forEach((button) => {
    button.onclick = () => {
      dashFilters.resetOne(button.dataset.reset);
      scrollTableToTop();
      render();
    };
  });
}

/* --------- Sorting the bar lists --------- */

// Sort [name, amount] pairs according to the list's sort settings
function sortPairs(data, kind) {
  const state = upperSort[kind];
  const out = [...data];
  const sign = state.dir === "asc" ? 1 : -1;

  if (state.by === "amount") {
    out.sort(
      (a, b) =>
        (a[1] - b[1]) * sign || String(a[0]).localeCompare(String(b[0])),
    );
  } else if (state.by === "name") {
    out.sort((a, b) => String(a[0]).localeCompare(String(b[0])) * sign);
  } else if (kind === "year") {
    out.sort((a, b) => (Number(a[0]) - Number(b[0])) * sign);
  }
  return out;
}

/* --------- Bar lists --------- */

// The four lists: which element and which record field each one shows
const LISTS = {
  category: { id: "catbars", field: "Category" },
  year: { id: "yearbars", field: "Year" },
  mode: { id: "modebars", field: "Mode" },
  month: { id: "months", field: "Month" },
};

// One clickable row. `key` says which filter a click will change.
function barRow(key, name, value, max) {
  const height = value > 0 ? Math.max(2, (value / max) * 100) : 0;
  const tip = esc(`${name}: ${money(value)}`);
  return `<button data-key="${key}" data-val="${esc(name)}" title="${tip}" aria-label="${tip}"><span class="col-track"><span class="col-fill" style="height:${height}%"></span></span><span class="col-name"><span class="col-label">${esc(name)}</span></span></button>`;
}

// Left value axis: 0, 25, 50, 75 and 100% of the largest bar
function yAxisHtml(max) {
    const labels = [1, 0.75, 0.5, 0.25, 0]
      .map(
        (p) =>
            `<span class="axis-val" style="top:${(1 - p) * 100}%">${p ? moneyShort(max * p) : "0"}</span>`,
      )
      .join("");
    return `<div class="axis-col yaxis"><div class="axis-plot">${labels}</div></div>`;
}

// Fill one bar list from [[name, total], ...]
function bars(containerId, data, key) {
  const container = $(containerId);
  if (!data.length) {
    container.innerHTML = NO_DATA_HTML;
    return;
  }
  const max = Math.max(...data.map((x) => x[1]), 1);
  container.innerHTML =
    yAxisHtml(max) +
    data.map(([name, value]) => barRow(key, name, value, max)).join("") +
    '<div class="axis-col filler"><div class="axis-plot"></div></div>';

}

// Area under the curve: a line joining the top-centre of every bar, with a
// light-blue fill below it down to the bars' base. Two SVG layers:
//   .bar-area-back  the fill, BEHIND the bars (bars stay solid blue)
//   .bar-area-front the line + dots, IN FRONT of the bars
// Both let clicks and hover through to the bars, and both stay under the
// sticky left axis. Positions are measured from the drawn bars, so they are
// redrawn after a resize (see redrawAreas).
const SVG_NS = "http://www.w3.org/2000/svg";

function areaLayer(cls, width, height, inner) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", `bar-area ${cls}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = inner;
    return svg;
}

// Measure one list: the top-centre of every bar, the bars' base and the
// content width. Returns null when there is no curve to draw. READS only.
function measureArea(container) {
    const tracks = [...container.querySelectorAll(".col-track")];
    if (tracks.length < 2) return null; // a single bar has no line to draw

    const box = container.getBoundingClientRect();
    if (!box.width) return null; // not visible, nothing to measure

    // Coordinates inside the scrollable content of the list
    const dx = container.scrollLeft - box.left;
    const dy = container.scrollTop - box.top;
    let base = 0;
    const points = tracks.map((track) => {
        const t = track.getBoundingClientRect();
        const fill = track.firstElementChild.getBoundingClientRect();
        base = Math.max(base, t.bottom + dy);
        return [t.left + t.width / 2 + dx, fill.top + dy];
    });
    return { points, base, width: container.scrollWidth };
}

// Add the two curve layers from measureArea()'s result. WRITES only.
function paintArea(container, { points, base, width }) {
    const fmt = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
    const line = points.map(fmt).join(" ");
    const firstX = points[0][0];
    const lastX = points[points.length - 1][0];

    const height = Math.ceil(base);
    const dots = points
      .map(
        ([x, y]) =>
            `<circle class="bar-area-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5"/>`,
      )
      .join("");

    container.append(
        areaLayer(
            "bar-area-back",
            width,
            height,
            `<polygon class="bar-area-fill" points="${fmt([firstX, base])} ${line} ${fmt([lastX, base])}"/>`,
        ),
        areaLayer(
            "bar-area-front",
            width,
            height,
            `<polyline class="bar-area-line" points="${line}"/>${dots}`,
        ),
    );
}

// (Re)draw the curves of the given lists in three batched steps -- remove
// the old layers, measure every list, then add the new layers -- so the
// browser lays the page out once, however many lists there are.
function drawAreas(containers) {
    containers.forEach((c) =>
        c.querySelectorAll(".bar-area").forEach((svg) => svg.remove()),
    );
    const measured = containers.map(measureArea);
    containers.forEach((c, i) => {
        if (measured[i]) paintArea(c, measured[i]);
    });
}

function drawArea(container) {
    drawAreas([container]);
}

// Re-measure the curves of all four lists (after a redraw or a resize)
function redrawAreas() {
    drawAreas(Object.values(LISTS).map((list) => $(list.id)));
}

// The Monthly list is special: always Jan-Dec order, hides empty months
function monthPairs() {
    const totals = view.groups.Month;
    const shown = CONFIG.months
      .map((name) => [name, totals.get(name) || 0])
      .filter((x) => x[1] > 0);

    if (upperSort.month.by === "amount") {
        // Biggest/smallest first; equal amounts keep calendar order (stable sort)
        const sign = upperSort.month.dir === "asc" ? 1 : -1;
        shown.sort((a, b) => (a[1] - b[1]) * sign);
    } else if (upperSort.month.dir === "desc") {
        shown.reverse();
    }
    return shown;
}

// Write one list's columns from the totals worked out by computeView()
function writeList(kind) {
    const list = LISTS[kind];
    const pairs =
        kind === "month"
            ? monthPairs()
            : sortPairs([...view.groups[list.field]], kind);
    bars(list.id, pairs, list.field);
}

// Redraw ONE list with its curve (after its sort menu changed)
function drawList(kind) {
    writeList(kind);
    drawArea($(LISTS[kind].id));
}

// One click handler per list (not one per bar): select just that value
function setupBarClicks() {
    Object.values(LISTS).forEach((list) => {
        $(list.id).onclick = (e) => {
            const button = e.target.closest("button[data-key]");
            if (!button) return;
            applyBarFilter(button.dataset.key, button.dataset.val);
            scrollTableToTop();
            render();
        };
    });
}

/* ------------ Main render ------------ */

// Filter the records AND add them up in ONE pass over the table order
function computeView() {
    const match = dashboardMatcher();
    const records = [];
    const byCategory = new Map();
    const byYear = new Map();
    const byMode = new Map();
    const byMonth = new Map();
    let sum = 0;

    if (match) {
        for (const r of tableRows) {
            if (!match(r)) continue;
            const amount = r.Amount;
            records.push(r);
            sum += amount;
            byCategory.set(r.Category, (byCategory.get(r.Category) || 0) + amount);
            byYear.set(r.Year, (byYear.get(r.Year) || 0) + amount);
            byMode.set(r.Mode, (byMode.get(r.Mode) || 0) + amount);
            byMonth.set(r.Month, (byMonth.get(r.Month) || 0) + amount);
        }
    }

    view = {
        records,
        sum,
        groups: { Category: byCategory, Year: byYear, Mode: byMode, Month: byMonth },
    };
}

/* --------- KPI cards --------- */

// Work out the KPI figures from ALL records (the filters are ignored), in
// one pass. Called once per load from rebuildAll(), not on filter changes.
function computeKpis() {
    // "Current year / month" = the LATEST month that has data (not today's
    // date), so the cards never show zero just because this month has no
    // entries yet
    let latest = "";
    for (const r of rows) if (r.Date > latest) latest = r.Date;
    const latestDate = latest ? new Date(latest + "T00:00:00Z") : new Date();
    const thisYear = String(latestDate.getUTCFullYear());
    const thisMonth = CONFIG.months[latestDate.getUTCMonth()];
    const monthsWithData = new Set(); // "2025-Mar", ... for the monthly average
    const categories = new Map(); // category -> total, all years
    const yearCategories = new Map(); // category -> total, this year only
    let sum = 0;
    let yearSum = 0;
    let monthSum = 0;

    for (const r of rows) {
        const amount = r.Amount;
        sum += amount;
        categories.set(r.Category, (categories.get(r.Category) || 0) + amount);
        monthsWithData.add(r.Year + "-" + r.Month);
        if (r.Year === thisYear) {
            yearSum += amount;
            yearCategories.set(
                r.Category,
                (yearCategories.get(r.Category) || 0) + amount,
            );
            if (r.Month === thisMonth) monthSum += amount;
        }
    }

    kpiData = {
        sum,
        monthCount: monthsWithData.size,
        categories,
        current: { year: thisYear, month: thisMonth, yearSum, monthSum, yearCategories },
    };
}

// The category with the biggest total -> [name, total] (or ["", 0])
function topEntry(totals) {
    let best = ["", 0];
    for (const entry of totals) if (entry[1] > best[1]) best = entry;
    return best;
}

// Two figures for each of the four cards. Each figure is [label, value],
// worked out from `kpiData` (all records, filters ignored).
// Card i shows KPI_SETS[kpiSides[i]][i].
const KPI_SETS = {
    overall: () => {
        const k = kpiData;
        const [topName, topTotal] = topEntry(k.categories);
        return [
            [`Total ${T("noun")}`, money(k.sum)],
            [
                `Average monthly ${T("noun")}`,
                money(k.monthCount ? k.sum / k.monthCount : 0),
            ],
            [topName ? `Top category · ${topName}` : "Top category", money(topTotal)],
            ["Categories", k.categories.size],
        ];
    },
    current: () => {
        const c = kpiData.current;
        const [topName, topTotal] = topEntry(c.yearCategories);
        return [
            [`${c.year} total ${T("noun")}`, money(c.yearSum)],
            [`${c.month} ${c.year} ${T("noun")}`, money(c.monthSum)],
            [
                topName ? `${c.year} top category · ${topName}` : `${c.year} top category`,
                money(topTotal),
            ],
            ["Categories", kpiData.categories.size],
        ];
    },
};

const otherSide = (side) => (side === "overall" ? "current" : "overall");

function renderKpis() {
    const sets = { overall: KPI_SETS.overall(), current: KPI_SETS.current() };

    document.querySelectorAll(".kpi").forEach((card, i) => {
        const side = kpiSides[i];
        const [label, value] = sets[side][i];
        const labelEl = card.querySelector(".kpi-label");
        labelEl.textContent = label;
        labelEl.title = label; // full text on hover if it is cut off
        card.querySelector(".kpi-value").textContent = value;

        // Dots: filled one = what is shown (1st = overall, 2nd = current).
        // The tooltip says what a click will show instead.
        const button = card.querySelector(".kpi-switch");
        button.dataset.side = side;
        const hint = "Show " + sets[otherSide(side)][i][0];
        button.title = hint;
        button.setAttribute("aria-label", hint);
    });
}

// The dots on a card flip only that card
function setupKpiSwitch() {
    document.querySelectorAll(".kpi-switch").forEach((button, i) => {
        button.onclick = () => {
            kpiSides[i] = otherSide(kpiSides[i]);
            renderKpis();
        };
    });
}

// The four bar lists (the KPI cards do not follow the filters; they are
// drawn by rebuildAll() in main.js)
function renderSummary() {
    // Write all four lists first, then measure for the curves in one go
    // (writing and measuring in turn would make the browser lay out 4 times)
    Object.keys(LISTS).forEach(writeList);
    redrawAreas();
}

function render() {
    computeView();
    renderSummary();
    renderTable();
    renderInsights();
}
