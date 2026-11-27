/* =========================================================================
table.js
The transactions table.

Built for tens of thousands of rows:
- Rows are sorted ONCE (when the file loads or a header is clicked).
- Filtering keeps that order, so typing in the search box never sorts.
- Only the rows you can see (plus a few spare ones) are put on the
  page. Two empty "spacer" rows above and below make the scrollbar
  behave as if every row were there. Scrolling swaps the visible rows.
- Every row is one line tall (long text is cut with "..."; hover to read
  it), because the scrolling maths needs a fixed row height.
========================================================================= */

const TABLE_OVERSCAN = 10; // spare rows drawn above and below the view
const ROW_HEIGHT_GUESS = 37; // used only until the real height is measured

const tableState = {
    rowHeight: 0, // measured height of one row (0 = not measured yet)
    start: -1, // first row index currently on the page
    end: -1, // one past the last row index currently on the page
};

// One collator, reused (making a new one per comparison is very slow)
const textCollator = new Intl.Collator(undefined, { sensitivity: "base" });

/* ------------ Sorting ------------ */

// Put the records in the order of the table's sort column
function sortTableRows() {
    const col = txSort.col;
    const sign = txSort.dir === "asc" ? 1 : -1;
    let compare;

    if (col === "Amount") {
        compare = (a, b) => (a.Amount - b.Amount) * sign;
    } else if (col === "Date") {
        // Dates are "YYYY-MM-DD", so plain text comparison orders them correctly
        compare = (a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0) * sign;
    } else {
        compare = (a, b) => textCollator.compare(a[col], b[col]) * sign;
    }

    // Sort a copy of the original order, so equal values keep file order
    tableRows = [...rows].sort(compare);
}

// Show the ↓ / ↑ arrow on the column the table is sorted by
function updateTxHeaders() {
    document.querySelectorAll("th.sortable").forEach((th) => {
        // The icon (see .sortarrow in main.css) lights its up triangle for
        // ascending (A-Z, oldest, smallest first) and its down triangle for
        // descending; a column that is not sorted keeps both light.
        const sorted = th.dataset.col === txSort.col;
        th.dataset.dir = sorted ? txSort.dir : "";
        th.setAttribute(
            "aria-sort",
            sorted ? (txSort.dir === "asc" ? "ascending" : "descending") : "none",
        );
    });
}

/* ------------ Drawing only the visible rows ------------ */

function tableScroller() {
    return $("tbody").closest(".scroll");
}

// Show the first row of the transactions table again.
// Called whenever the filters or the search text change.
function scrollTableToTop() {
    tableScroller().scrollTop = 0;
}

// An empty row that stands in for the rows that are not on the page
function spacerRow(height) {
    return height > 0
        ? `<tr class="vspacer" aria-hidden="true"><td colspan="5" style="height:${height}px"></td></tr>`
        : "";
}

function rowHtml(r) {
    const particular = esc(r.Particular);
    const category = esc(r.Category);
    const mode = esc(r.Mode);
    return `<tr class="vrow"><td>${r.Date}</td><td title="${particular}">${particular}</td><td title="${category}">${category}</td><td title="${mode}">${mode}</td><td>${money(r.Amount)}</td></tr>`;
}

// Draw the rows that are in view now (does nothing if they already are)
function drawVisibleRows(force = false) {
    const body = $("tbody");
    const scroller = tableScroller();
    const list = view.records;
    const n = list.length;

    if (!n) {
        body.innerHTML = "";
        tableState.start = tableState.end = -1;
        return;
    }

    const rh = tableState.rowHeight || ROW_HEIGHT_GUESS;
    const count = Math.ceil((scroller.clientHeight || 310) / rh) + 2 * TABLE_OVERSCAN;
    let first = Math.floor(scroller.scrollTop / rh) - TABLE_OVERSCAN;
    first = Math.max(0, Math.min(first, n - count));
    const last = Math.min(n, first + count);

    if (!force && first === tableState.start && last === tableState.end) return;
    tableState.start = first;
    tableState.end = last;

    let html = spacerRow(first * rh);
    for (let i = first; i < last; i++) html += rowHtml(list[i]);
    html += spacerRow((n - last) * rh);
    body.innerHTML = html;

    // First draw: measure the real row height, then draw again with it
    if (!tableState.rowHeight) {
        const sample = body.querySelector("tr.vrow");
        const height = sample ? sample.getBoundingClientRect().height : 0;
        if (height > 0) {
            tableState.rowHeight = height;
            drawVisibleRows(true);
        }
    }
}

// Draw the table from view.records (after any filter / sort change)
function renderTable() {
    drawVisibleRows(true);
}

// The row height can change with the screen size (phones use more padding)
function resetTableMetrics() {
    tableState.rowHeight = 0;
    drawVisibleRows(true);
}

/* ------------ Header clicks and scrolling ------------ */

function setupTxSort() {
    // Clicking a header sorts by it; clicking again flips the direction
    document.querySelectorAll("th.sortable").forEach((th) => {
        th.onclick = () => {
            const col = th.dataset.col;
            if (txSort.col === col) {
                txSort.dir = txSort.dir === "asc" ? "desc" : "asc";
            } else {
                txSort.col = col;
                txSort.dir = col === "Amount" ? "desc" : "asc";
            }
            scrollTableToTop();
            sortTableRows();
            view.records = current(); // same records, new order
            renderTable();
            updateTxHeaders();
        };
    });

    // Swap the visible rows while scrolling. Browsers already send at most one
    // scroll event per frame, and drawVisibleRows() does nothing when the same
    // rows are still in view, so no extra throttling is needed.
    tableScroller().addEventListener("scroll", () => drawVisibleRows(), {
        passive: true,
    });

    updateTxHeaders();
}
