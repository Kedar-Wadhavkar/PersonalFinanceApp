import { CONFIG } from "./config";
import { excelDate, parseAmount } from "./cellValues";
import { moduleData } from "./modules";
import { activePage, showPage } from "./overview";
import { activeCurrency, setActiveCurrency } from "./state";
import type {
  CashFlow,
  Dividend,
  Holding,
  HoldingInfo,
  MarketData,
  MarketOrder,
  MarketSummary,
  SheetGrid,
  SheetMatrix,
} from "./types";
import { createMultiSelect, type MultiSelect } from "./multiselect";
import { $, NO_DATA_HTML, emptyCardHtml, wireMultiToggles, esc, money, moneyShort, moneySign, setMoneyCurrency, signedMoney, todayIso } from "./utils";

/* =========================================================================
market.ts
The Market page (#marketPage): shares, ETFs and mutual funds.

Reads up to two tables, found by their HEADINGS (sheet names do not
matter, so they may sit in the finance workbook or in a separate file):

  Orders (required) .... Date, Order (Buy/Sell), Holding, Units, UnitAvg;
                         optional LotValue, Charges, IndexValue, EqCumUnits
  Holdings (optional) .. Holding plus LTP (latest price); optional Instrument
                         (older files: Category), Sector, SubSector, Units
                         (older files: Qty), Avg. Gives the current prices.

Quantity, average cost and invested amount are worked out from the orders
(average-cost method, as in the sheet's CurrentInv / SoldInv columns), so a
holdings table that is a few days old still shows the latest buys. Only the
price (LTP) and the instrument type come from the holdings table.

Dividends are not in the market file: they are the rows of the Income sheet
whose Category is "Dividend" and whose Particulars read "Dividend: HOLDING".
========================================================================= */

let marketData: MarketData | null = null; // parseMarket() result, null until a file has orders
export function setMarketData(value: MarketData): void {
  marketData = value;
}
export function hasMarketData(): boolean {
  return marketData !== null;
}
export function getMarketData(): MarketData | null {
  return marketData;
}

// Every drawing function below runs only once marketData is set
const data = (): MarketData => marketData!;

const MK_CATEGORY_COLORS: Record<string, string> = {
  ETF: "#2563eb",
  MutualFund: "#0f766e",
  Stock: "#7c3aed",
};
const mkCatColor = (c: string): string => MK_CATEGORY_COLORS[c] || "#64748b";

export const mkState: {
  calYear: number | null;
  treeBy: "invested" | "current";
  sortKey: string;
  sortDir: number;
  holding: string | null;
  histOpen: Set<string> | null;
  divBy: "month" | "holding";
  divOpen: Set<string>;
} = {
  calYear: null,
  treeBy: "invested", // "invested" | "current"
  sortKey: "current",
  sortDir: -1,
  holding: null, // buy history
  histOpen: null, // years unfolded in the buy history table (null = newest only)
  divBy: "month", // "month" | "holding"
  divOpen: new Set(),
};

/* ------------ Reading the tables ------------ */

const mkNorm = (s: unknown): string => String(s ?? "").toLowerCase().replace(/[^a-z0-9%&]/g, "");

// First row (of the top 5) holding all `needed` headings -> { row, cols }
export function mkFindHeader(
  grid: SheetGrid,
  needed: string[],
): { row: number; cols: Record<string, number> } | null {
  for (let r = 0; r < Math.min(5, grid.length); r++) {
    const row = grid[r] || [];
    const cols: Record<string, number> = {};
    row.forEach((cell, c) => {
      const k = mkNorm(cell);
      if (k && cols[k] === undefined) cols[k] = c;
    });
    if (needed.every((n) => n.split("|").some((alt) => cols[alt] !== undefined))) return { row: r, cols };
  }
  return null;
}

const mkIso = (v: unknown): string | null => {
  const d = excelDate(v);
  return d ? d.toISOString().slice(0, 10) : null;
};

const mkNum = (v: unknown): number | null => {
  const n = parseAmount(v);
  return n !== null && Number.isFinite(n) ? n : null;
};

export function parseMarket(sheets: SheetMatrix[]): MarketData | null {
  const orders: MarketOrder[] = [];
  const info = new Map<string, HoldingInfo>();
  let skipped = 0;
  const sheetNames: string[] = [];

  for (const { name, grid } of sheets) {
    // Orders
    let h = mkFindHeader(grid, ["date", "order", "holding", "units", "unitavg|price"]);
    if (h) {
      sheetNames.push(name);
      const c = h.cols;
      const get = (row: SheetGrid[number] & {}, key: string) => (c[key] === undefined ? undefined : row[c[key]]);
      for (let r = h.row + 1; r < grid.length; r++) {
        const row = grid[r];
        if (!row) continue;
        const holding = String(get(row, "holding") ?? "").trim();
        const date = mkIso(get(row, "date"));
        const units = mkNum(get(row, "units"));
        const price = mkNum(get(row, "unitavg") ?? get(row, "price"));
        if (!holding && !date) continue;
        if (!holding || !date || units === null || price === null) {
          skipped++;
          continue;
        }
        const type: MarketOrder["type"] = /^s/i.test(String(get(row, "order") ?? "")) || units < 0 ? "Sell" : "Buy";
        orders.push({
          date,
          type,
          holding,
          units: Math.abs(units),
          price,
          value: Math.abs(mkNum(get(row, "lotvalue")) ?? units * price),
          charges: mkNum(get(row, "charges")) || 0,
          index: mkNum(get(row, "indexvalue")),
          eqUnits: mkNum(get(row, "eqcumunits")),
        });
      }
      continue;
    }
    // Holdings with prices
    h = mkFindHeader(grid, ["holding", "ltp"]);
    if (h) {
      sheetNames.push(name);
      const c = h.cols;
      for (let r = h.row + 1; r < grid.length; r++) {
        const row = grid[r];
        if (!row) continue;
        const holding = String(row[c.holding!] ?? "").trim();
        if (!holding || typeof row[c.holding!] === "number") continue; // total row
        const txt = (k: string) => (c[k] === undefined ? "" : String(row[c[k]] ?? "").trim());
        info.set(holding, {
          category: txt("instrument") || txt("category") || "Other", // "Category" = older files
          sector: txt("sector"),
          subSector: txt("subsector"),
          ltp: mkNum(row[c.ltp!]),
          qty: c.units !== undefined ? mkNum(row[c.units]) : c.qty === undefined ? null : mkNum(row[c.qty]), // "Qty" = older files
          avg: c.avg === undefined ? null : mkNum(row[c.avg]),
        });
      }
      continue;
    }
  }
  if (!orders.length) return null;
  orders.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { orders, info, skipped, sheetNames };
}

/* ------------ Working out the holdings ------------ */

const MK_DAY = 86400000;
const mkDays = (a: string, b: string): number => (Date.parse(b) - Date.parse(a)) / MK_DAY;
// Today on the device (toISOString would give the UTC date)
const mkToday = (): string => todayIso();

// Annual return of dated cash flows (negative = money in), by bisection
export function mkXirr(flows: CashFlow[]): number | null {
  if (flows.length < 2 || !flows.some((f) => f.v > 0) || !flows.some((f) => f.v < 0)) return null;
  const t0 = flows[0]!.d;
  const npv = (r: number) => flows.reduce((s, f) => s + f.v / Math.pow(1 + r, mkDays(t0, f.d) / 365), 0);
  let lo = -0.9999;
  let hi = 100;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// A holding while its orders are added up; the price fields come after
type HoldingDraft = Pick<Holding, "name" | "qty" | "invested" | "realised" | "charges" | "lots" | "flows"> &
  Partial<Holding>;

export function marketSummary(): MarketSummary {
  const d = data();
  const today = mkToday();
  const map = new Map<string, HoldingDraft>();
  for (const o of d.orders) {
    let h = map.get(o.holding);
    if (!h) {
      h = { name: o.holding, qty: 0, invested: 0, realised: 0, charges: 0, lots: [], flows: [], first: o.date, last: o.date };
      map.set(o.holding, h);
    }
    h.last = o.date;
    h.charges += o.charges;
    if (o.type === "Buy") {
      h.qty += o.units;
      h.invested += o.value;
      h.lots.push({ date: o.date, units: o.units });
      h.flows.push({ d: o.date, v: -o.value });
    } else {
      // A sell can only take what is held; the proceeds of any extra units
      // (an order typed twice, a missing buy) are not counted as profit
      const units = Math.min(o.units, h.qty);
      const cost = h.qty ? (h.invested / h.qty) * units : 0;
      const proceeds = o.units ? (o.value * units) / o.units : 0;
      h.realised += proceeds - cost;
      h.invested -= cost;
      h.qty -= units;
      h.flows.push({ d: o.date, v: o.value });
      let left = units; // oldest lots are sold first
      while (left > 1e-9 && h.lots.length) {
        const lot = h.lots[0]!;
        const take = Math.min(lot.units, left);
        lot.units -= take;
        left -= take;
        if (lot.units <= 1e-9) h.lots.shift();
      }
    }
  }
  // Holdings only in the holdings table (no orders), e.g. a gift or a rename
  for (const [name, i] of d.info) {
    if (!map.has(name) && i.qty) {
      map.set(name, { name, qty: i.qty, invested: (i.avg || 0) * i.qty, realised: 0, charges: 0, lots: [], flows: [], noOrders: true });
    }
  }

  const drafts = [...map.values()];
  for (const h of drafts) {
    const i = d.info.get(h.name);
    h.category = i?.category || "Other";
    h.sector = i?.subSector || i?.sector || "";
    h.ltp = i?.ltp ?? null;
    h.avg = h.qty ? h.invested / h.qty : 0;
    const currentValue = h.ltp !== null ? h.qty * h.ltp : h.invested;
    h.current = currentValue;
    h.pnl = currentValue - h.invested;
    h.pct = h.invested ? h.pnl / h.invested : 0;
    h.ltQty = h.lots.filter((l) => mkDays(l.date, today) > 365).reduce((s, l) => s + l.units, 0);
    h.xirr = h.qty > 1e-9 && h.ltp !== null ? mkXirr([...h.flows, { d: today, v: currentValue }]) : null;
    h.share = 0;
  }
  // Every field is filled in now
  const all = drafts as Holding[];
  const held = all.filter((h) => h.qty > 1e-9);
  const invested = held.reduce((s, h) => s + h.invested, 0);
  const current = held.reduce((s, h) => s + h.current, 0);
  held.forEach((h) => (h.share = current ? h.current / current : 0));

  const flows = d.orders.map((o): CashFlow => ({ d: o.date, v: o.type === "Buy" ? -o.value : o.value }));
  const xirr = mkXirr([...flows, { d: today, v: current }]);

  // Nifty 50 benchmark: the same cash flows put into the index
  const withIndex = d.orders.filter((o) => o.index && o.eqUnits !== null);
  const lastIx = withIndex[withIndex.length - 1];
  const bench =
    lastIx && lastIx.index !== null && lastIx.eqUnits !== null
      ? { value: lastIx.eqUnits * lastIx.index, index: lastIx.index, date: lastIx.date }
      : null;

  return {
    held,
    all,
    invested,
    current,
    pnl: current - invested,
    realised: all.reduce((s, h) => s + h.realised, 0),
    charges: all.reduce((s, h) => s + h.charges, 0),
    xirr,
    bench,
    noPrice: held.filter((h) => h.ltp === null),
  };
}

/* ------------ Formatting ------------ */

const mkPriceFmt = (): Intl.NumberFormat =>
  new Intl.NumberFormat(CONFIG.currencyLocales?.[activeCurrency] || CONFIG.currencyLocaleDefault || "en-IN", {
    style: "currency",
    currency: activeCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
let mkPrice: (n: number) => string = (n) => String(n);
export const mkPct = (v: number | null | undefined, digits = 1): string => {
  if (v === null || v === undefined) return "–";
  const text = (v * 100).toFixed(digits);
  return `${Number(text) === 0 ? (0).toFixed(digits) : text}%`; // never "-0.0%"
};
// The sign follows the figure as shown: -0.0004 is "0.0%", not "−0.0%"
export const mkSignPct = (v: number | null): string => {
  if (v === null) return "–";
  const text = Math.abs(v * 100).toFixed(1);
  const zero = Number(text) === 0;
  return `${zero ? "" : v > 0 ? "+" : "−"}${text}%`;
};
const mkSigned = (v: number): string => signedMoney(v);
export const mkQty = (q: number): string => (Number.isInteger(Math.round(q * 1000) / 1000) ? String(Math.round(q)) : q.toFixed(3));
// Colour of a money figure: none for one shown as "₹0"
const mkCls = (v: number): string => ["mk-neg", "", "mk-pos"][moneySign(v) + 1]!;
// Colour of a share (P/L %, XIRR): none for one shown as "0.0%"
const mkPctCls = (v: number): string => (Math.abs(v) < 0.0005 ? "" : v < 0 ? "mk-neg" : "mk-pos");
export const mkDate = (iso: string): string => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

/* ------------ Drawing ------------ */

function renderMarket(): void {
  if (activePage !== "market") return;
  const body = $("mkBody");
  if (!marketData) {
    $("mkSub").textContent = "Shares, ETFs and mutual funds";
    body.innerHTML = emptyCardHtml(
      "Market",
      "Track your investments",
      "Load your market file (it can be chosen together with the finance workbook). It needs a sheet with Date, Order, Holding, Units and UnitAvg headings. A second sheet with Holding and LTP headings gives today's prices.",
    );
    return;
  }
  mkPrice = mkPriceFmt().format;
  const s = marketSummary();
  const o = marketData.orders;
  $("mkSub").textContent = `${o.length.toLocaleString(CONFIG.locale)} orders from ${mkDate(o[0]!.date)} to ${mkDate(o[o.length - 1]!.date)} · ${s.held.length} holdings`;

  if (!mkState.holding || !s.all.some((h) => h.name === mkState.holding)) {
    mkState.holding = [...s.held].sort((a, b) => b.current - a.current)[0]?.name || s.all[0]!.name;
  }

  body.innerHTML = `
    ${mkCards(s)}
    <section class="card card-gap" id="mkTableCard">${mkTableHtml()}</section>
    ${mkCalendar()}
    <div class="mk-pair">
      <section class="card" id="mkTreeCard">${mkTreemapHtml()}</section>
      <section class="card" id="mkBarsCard">${mkBarsHtml()}</section>
    </div>
    <div class="mk-pair">
      <section class="card mk-fixed" id="mkHistory">${mkHistoryHtml()}</section>
      <section class="card mk-fixed" id="mkDividends">${mkDividendsHtml()}</section>
    </div>`;
  mkSetupInst(mkTreeInst, drawMkTree);
  mkSetupInst(mkBarsInst, drawMkBars);
  setupMkCalendar();
  setupMkTableFilter();
  setupMkHistory();
  setupMkDividends();
  drawMkTree();
  drawMkBars();
}

function mkCards(s: MarketSummary): string {
  const noPrice = s.noPrice.length
    ? `${s.noPrice.length} without a price, counted at cost`
    : "At the latest prices (LTP)";
  const cards: { label: string; value: string; sub: string; cls?: string; title?: string }[] = [
    { label: "Invested now", value: money(s.invested), sub: `Cost of ${s.held.length} holdings` },
    { label: "Current value", value: money(s.current), sub: noPrice },
    {
      label: "Profit / loss",
      value: mkSigned(s.pnl),
      sub: `${mkSignPct(s.invested ? s.pnl / s.invested : 0)} · booked ${mkSigned(s.realised)}`,
      cls: mkCls(s.pnl),
    },
    { label: "XIRR", value: s.xirr === null ? "–" : mkPct(s.xirr), sub: "Yearly return of all orders", cls: mkPctCls(s.xirr || 0) },
  ];
  if (s.bench) {
    const diff = s.current - s.bench.value;
    cards.push({
      label: "Same money in Nifty 50",
      value: money(s.bench.value),
      sub: `${diff >= 0 ? "You are ahead by" : "You are behind by"} ${money(Math.abs(diff))}`,
      cls: "",
      title: `Every buy and sell repeated in the Nifty 50 index, valued at ${s.bench.index.toLocaleString(CONFIG.locale)} (index level of your last order, ${mkDate(s.bench.date)})`,
    });
  }
  return `<section class="mk-kpis">${cards
    .map(
      (c) => `<div class="card ov-kpi"${c.title ? ` title="${esc(c.title)}"` : ""}><span class="small ov-kpi-label">${esc(c.label)}</span><b class="${c.cls || ""}">${esc(c.value)}</b><span class="small">${esc(c.sub)}</span></div>`,
    )
    .join("")}</section>
    <div class="small mk-foot">Charges paid on all orders: ${esc(money(s.charges))}${data().skipped ? ` · ${data().skipped} order rows skipped (date, holding, units or price missing)` : ""}</div>`;
}

/* ---- Investment calendar ---- */

// Same layout and filter bar as the Expense calendar (heatmap.ts), so the
// CSS classes of that calendar (.heat-*) are reused. Only the colours differ.
// Filters: Year (one at a time), Months, Holding, Instrument, Order (Buy / Sell).
const MKC_WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"]; // Sunday first
const MKC_FILTERS = [
  { id: "Year", label: "Year" },
  { id: "Month", label: "Months" },
  { id: "Hold", label: "Holding" },
  { id: "Cat", label: "Instrument" },
  { id: "Ord", label: "Order" },
] as const;
type MkcName = "years" | "months" | "holds" | "cats" | "orders";
const MKC_KEYS: MkcName[] = ["years", "months", "holds", "cats", "orders"];

let mkcMenus = {} as Record<MkcName, MultiSelect>;
// Last choice of each dropdown, kept when the page is redrawn (e.g. new currency)
let mkcChoice: Partial<Record<MkcName, string[]>> = {};
let mkcAllValues = {} as Record<MkcName, string[]>;

const mkcCategoryOf = (holding: string): string => data().info.get(holding)?.category || "Other";

function mkCalendar(): string {
  const fields = MKC_FILTERS.map(({ id, label }) => {
    const p = "mkc" + id;
    return (
      `<div class="field"><span class="small field-label" id="${p}Label">${label}</span>` +
      `<div id="${p}Multi" class="multi">` +
      `<button type="button" id="${p}Toggle" aria-labelledby="${p}Label ${p}Toggle">All selected ▾</button>` +
      `<div id="${p}Menu" class="multi-menu"></div></div></div>`
    );
  }).join("");
  return `<section class="card card-gap" id="mkCalendar">
    <div>
      <div class="graphtitle"><b>Investment calendar</b></div>
      <div class="small">Click a coloured day to see its orders</div>
    </div>
    <div class="filters chart-filters" id="mkcBar">${fields}<button type="button" id="mkcReset">Reset</button></div>
    <div id="mkcBody" class="mkc-body"></div>
  </section>`;
}

// Build the five dropdowns and draw the months (called after the page HTML is set)
function setupMkCalendar(): void {
  const orders = data().orders;
  const years = [...new Set(orders.map((o) => o.date.slice(0, 4)))].sort().reverse(); // newest first
  const holds = [...new Set(orders.map((o) => o.holding))].sort((a, b) => a.localeCompare(b));
  const cats = [...new Set(holds.map(mkcCategoryOf))].sort((a, b) => a.localeCompare(b));
  mkcAllValues = { years, months: [...CONFIG.months], holds, cats, orders: ["Buy", "Sell"] };

  const wanted = mkcChoice.years?.[0] ?? (mkState.calYear !== null ? String(mkState.calYear) : null);
  MKC_KEYS.forEach((name, i) => {
    const p = "mkc" + MKC_FILTERS[i]!.id;
    mkcMenus[name] = createMultiSelect({
      menuId: p + "Menu",
      toggleId: p + "Toggle",
      cls: p + "Check",
      values: mkcAllValues[name],
      onChange: () => {
        mkcChoice[name] = mkcMenus[name].values();
        if (name === "years") mkState.calYear = Number(mkcMenus.years.values()[0]) || null;
        drawMkCalendar();
      },
      ...(name === "years" ? { limit: 1, headerLabel: "Latest", latestOnly: true } : {}),
    });
    // Put back what was ticked before, where it still exists
    const kept = name === "years" ? (wanted && years.includes(wanted) ? [wanted] : null) : mkcChoice[name]?.filter((v) => mkcAllValues[name].includes(v));
    if (kept) mkcMenus[name].setValues(kept);
  });
  mkState.calYear = Number(mkcMenus.years.values()[0]) || null;

  wireMultiToggles(MKC_FILTERS.map((f) => `mkc${f.id}Multi`));
  $("mkcReset").onclick = () => {
    mkcChoice = {};
    mkState.calYear = null;
    setupMkCalendar();
  };
  drawMkCalendar();
}

function drawMkCalendar(): void {
  const box = $("mkcBody");
  const year = mkcMenus.years.values()[0];
  const months = mkcMenus.months.set();
  const holds = mkcMenus.holds.set();
  const cats = mkcMenus.cats.set();
  const types = mkcMenus.orders.set();
  if (!year || !months.size || !holds.size || !cats.size || !types.size) {
    box.innerHTML = NO_DATA_HTML;
    return;
  }

  // Matching orders of the chosen year, grouped by day
  const byDay = new Map<string, { buy: number; sell: number; list: MarketOrder[] }>();
  for (const o of data().orders) {
    if (
      o.date.startsWith(year + "-") &&
      months.has(CONFIG.months[Number(o.date.slice(5, 7)) - 1]!) &&
      holds.has(o.holding) &&
      cats.has(mkcCategoryOf(o.holding)) &&
      types.has(o.type)
    ) {
      const e = byDay.get(o.date) || { buy: 0, sell: 0, list: [] };
      e[o.type === "Buy" ? "buy" : "sell"] += o.value;
      e.list.push(o);
      byDay.set(o.date, e);
    }
  }
  // A day is coloured only by what was bought. A day with a sell gets a red
  // border, on every view (with only Sell ticked those days stay uncoloured).
  const sellOnly = !types.has("Buy");
  const hasSells = types.has("Sell");
  const amount = (e: { buy: number; sell: number }) => e.buy;

  // Colour steps (about half the days in the lightest colour, a few in the darkest)
  const amounts = [...byDay.values()].map(amount).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p: number) => amounts[Math.min(amounts.length - 1, Math.floor(p * amounts.length))] || 0;
  const steps = [q(0.5), q(0.8), q(0.95)];
  const level = (v: number) => (v <= steps[0]! ? 1 : v <= steps[1]! ? 2 : v <= steps[2]! ? 3 : 4);

  const y = Number(year);
  const todayMs = new Date().setHours(0, 0, 0, 0);
  const plural = (n: number) => `${n} transaction${n === 1 ? "" : "s"}`;

  const monthHtml = (m: number): string => {
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    let html = `<div class="heat-month"><div class="heat-month-name">${CONFIG.months[m]!.slice(0, 3)}</div><div class="heat-grid">`;
    html += MKC_WEEKDAYS.map((d) => `<span class="heat-wd">${d}</span>`).join("");
    for (let i = 0; i < new Date(y, m, 1).getDay(); i++) html += `<span></span>`;
    let net = 0;
    let sold = 0;
    let count = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const e = byDay.get(iso);
      if (!e) {
        html += `<span class="heat-day heat-none"></span>`;
        continue;
      }
      net += e.buy - e.sell;
      sold += e.sell;
      count += e.list.length;
      const tip = `${mkDate(iso)}: ${e.list.map((o) => `${o.type} ${mkQty(o.units)} ${o.holding} ${money(o.value)}`).join("; ")}`;
      const v = amount(e);
      html += `<button type="button" class="heat-day ${v > 0 ? `mk-l${level(v)}` : "heat-none"}${e.sell ? " mk-sell" : ""}" data-day="${iso}" title="${esc(tip)}" aria-label="${esc(tip)}"></button>`;
    }
    html += `</div>`;
    // Figures under the month (not for a month that has not started yet)
    if (new Date(y, m, 1).getTime() <= todayMs) {
      html += `<div class="heat-month-foot"><div class="heat-month-total">${money(sellOnly ? sold : net)}</div><div>${plural(count)}</div></div>`;
    }
    return html + `</div>`;
  };

  const chosen = CONFIG.months.map((_, m) => m).filter((m) => months.has(CONFIG.months[m]!));
  let html = `<div class="heat-year">${esc(year)}</div><div class="heat-months">${chosen.map(monthHtml).join("")}</div>`;
  const sellKey = hasSells ? `<i class="heat-swatch mk-sellkey"></i><span class="small">Day with a sell</span>` : "";
  if (amounts.length) {
    html += `<div class="heat-legend"><span class="small">${money(amounts[0]!)}</span>${[1, 2, 3, 4]
      .map((l) => `<i class="heat-swatch mk-l${l}"></i>`)
      .join("")}<span class="small">${money(amounts[amounts.length - 1]!)}</span>${sellKey}</div>`;
  } else if (sellKey) {
    html += `<div class="heat-legend">${sellKey}</div>`;
  } else {
    html += `<div class="heat-legend"><span class="small">No orders in this selection</span></div>`;
  }
  html += `<div class="small mkc-info" id="mkDayInfo"></div>`;
  box.innerHTML = html;
}

/* ---- Instrument filter (Portfolio map and Invested vs current each have their own) ---- */

interface MkInst {
  prefix: string;
  menu: MultiSelect | null;
  choice: string[] | null; // ticked instruments, kept when the page is redrawn
}
const mkTreeInst: MkInst = { prefix: "mkt", menu: null, choice: null };
const mkBarsInst: MkInst = { prefix: "mkv", menu: null, choice: null };

const mkInstFilterHtml = (i: MkInst): string =>
  `<div class="filters chart-filters">
      <div class="field"><span class="small field-label" id="${i.prefix}InstLabel">Instrument</span>
        <div id="${i.prefix}InstMulti" class="multi">
          <button type="button" id="${i.prefix}InstToggle" aria-labelledby="${i.prefix}InstLabel ${i.prefix}InstToggle">All selected ▾</button>
          <div id="${i.prefix}InstMenu" class="multi-menu"></div>
        </div>
      </div>
      <button type="button" id="${i.prefix}Reset">Reset</button>
    </div>`;

function mkSetupInst(i: MkInst, onChange: () => void): void {
  const values = [...new Set(marketSummary().held.map((h) => h.category))].sort((a, b) => a.localeCompare(b));
  i.menu = createMultiSelect({
    menuId: `${i.prefix}InstMenu`,
    toggleId: `${i.prefix}InstToggle`,
    cls: `${i.prefix}InstCheck`,
    values,
    onChange: () => {
      i.choice = i.menu!.values();
      onChange();
    },
  });
  const kept = i.choice?.filter((v) => values.includes(v)) ?? [];
  if (kept.length) i.menu.setValues(kept);
  wireMultiToggles([`${i.prefix}InstMulti`]);
  $(`${i.prefix}Reset`).onclick = () => {
    i.choice = null;
    mkSetupInst(i, onChange);
    onChange();
  };
}

const mkFiltered = (s: MarketSummary, i: MkInst): Holding[] => {
  const on = i.menu?.set();
  return on ? s.held.filter((h) => on.has(h.category)) : s.held;
};

/* ---- Treemap ---- */

// Card shell: title, Instrument filter row, the Invested / Current value switch
// under it (right-aligned, like Dividends) and the map. drawMkTree() fills it.
function mkTreemapHtml(): string {
  return `<div><div class="graphtitle"><b>Portfolio map</b></div><div class="small" id="mkTreeDesc"></div></div>
    ${mkInstFilterHtml(mkTreeInst)}
    <div class="mk-togglerow"><div class="ov-period" role="group" aria-label="Size by">
        <button type="button" data-tree="invested">Invested</button>
        <button type="button" data-tree="current">Current value</button>
    </div></div>
    <div class="mk-tree" id="mkTree"></div>`;
}

function drawMkTree(): void {
  const by = mkState.treeBy;
  $("mkTreeDesc").textContent = `Each box is a holding, sized by its ${by === "invested" ? "invested amount" : "current value"}. Click one to see its buys.`;
  $("mkTreeCard")
    .querySelectorAll<HTMLElement>("[data-tree]")
    .forEach((b) => {
      const on = b.dataset.tree === by;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
  mkLayoutTreemap(marketSummary());
}

// Squarified treemap: items [{value}] -> same items with x, y, w, h
export function mkSquarify<I extends { value: number }>(
  items: I[],
  x: number,
  y: number,
  w: number,
  h: number,
): (I & { x: number; y: number; w: number; h: number })[] {
  const out: (I & { x: number; y: number; w: number; h: number })[] = [];
  let rest = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = rest.reduce((s, i) => s + i.value, 0);
  if (!total) return out;
  const scale = (w * h) / total;
  let row: I[] = [];
  const worst = (r: I[], side: number) => {
    const sum = r.reduce((s, i) => s + i.value * scale, 0);
    const max = Math.max(...r.map((i) => i.value * scale));
    const min = Math.min(...r.map((i) => i.value * scale));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  const layRow = () => {
    const sum = row.reduce((s, i) => s + i.value * scale, 0);
    if (w >= h) {
      const cw = sum / h;
      let cy = y;
      row.forEach((i) => {
        const ch = (i.value * scale) / cw;
        out.push({ ...i, x, y: cy, w: cw, h: ch });
        cy += ch;
      });
      x += cw;
      w -= cw;
    } else {
      const ch = sum / w;
      let cx = x;
      row.forEach((i) => {
        const cw2 = (i.value * scale) / ch;
        out.push({ ...i, x: cx, y, w: cw2, h: ch });
        cx += cw2;
      });
      y += ch;
      h -= ch;
    }
    row = [];
  };
  while (rest.length) {
    const side = Math.min(w, h);
    const next = rest[0]!;
    if (!row.length || worst([...row, next], side) <= worst(row, side)) {
      row.push(next);
      rest = rest.slice(1);
    } else {
      layRow();
    }
  }
  if (row.length) layRow();
  return out;
}

function mkLayoutTreemap(s: MarketSummary): void {
  const box = $("mkTree");
  if (!box) return;
  const W = box.clientWidth || 800;
  const H = W < 600 ? 420 : 380;
  box.style.height = `${H}px`;
  const list = mkFiltered(s, mkTreeInst);
  const total = list.reduce((t, h) => t + h[mkState.treeBy], 0);
  const rects = mkSquarify(
    list.map((h) => ({ item: h, value: h[mkState.treeBy] })),
    0,
    0,
    W,
    H,
  );
  box.innerHTML = rects
    .map((r) => {
      const h = r.item;
      const share = total ? r.value / total : 0;
      const tip = `${h.name} · ${h.category}\n${mkState.treeBy === "invested" ? "Invested" : "Current value"} ${money(r.value)} (${mkPct(share)} of total)\nProfit / loss ${mkSigned(h.pnl)} (${mkSignPct(h.pct)})`;
      const big = r.w > 84 && r.h > 38;
      // Lighter box = smaller share inside its category colour
      return `<button type="button" class="mk-tile" data-holding="${esc(h.name)}" title="${esc(tip)}" aria-label="${esc(`${h.name} ${mkPct(share)}, ${tip.slice(h.name.length + 3).replace(/\n/g, ", ")}`)}"
        style="left:${r.x.toFixed(1)}px;top:${r.y.toFixed(1)}px;width:${Math.max(0, r.w - 2).toFixed(1)}px;height:${Math.max(0, r.h - 2).toFixed(1)}px;background:${mkCatColor(h.category)};opacity:${(0.55 + Math.min(0.45, share * 6)).toFixed(2)}">
        ${big ? `<span class="mk-tile-name">${esc(h.name)}</span> <span class="mk-tile-val">${esc(mkPct(share))}</span>` : ""}
      </button>`;
    })
    .join("");
}

/* ---- Invested vs current value per holding ---- */

// Card shell: title, Instrument filter row, the chart and, under it, the centred legend.
function mkBarsHtml(): string {
  return `<div><div class="graphtitle"><b>Invested vs current value</b></div><div class="small">Per holding, largest investment first</div></div>
    ${mkInstFilterHtml(mkBarsInst)}
    <div id="mkvBody" class="bars bars-slant mk-bars"></div>
    <div class="legend"><span class="legend-btn"><span class="legend-swatch" style="background:#93c5fd"></span>Invested</span><span class="legend-btn"><span class="legend-swatch" style="background:#2563eb"></span>Current (gain)</span><span class="legend-btn"><span class="legend-swatch" style="background:#f59e0b"></span>Current (loss)</span></div>`;
}

// Built exactly like the Expense breakdown bars (same classes and CSS: .bars,
// .bars-slant, .col-track, .col-name, left axis with 0 / 25 / 50 / 75 / 100% and
// gridlines, hidden scrollbar, names slanted at 45 degrees and cut at 72px).
// Each holding has two bars in its column: invested and current value.
function drawMkBars(): void {
  const box = $("mkvBody");
  const list = [...mkFiltered(marketSummary(), mkBarsInst)].sort((a, b) => b.invested - a.invested);
  if (!list.length) {
    box.innerHTML = NO_DATA_HTML;
    return;
  }
  const top = Math.max(1, ...list.map((h) => Math.max(h.invested, h.current)));
  const axis = [1, 0.75, 0.5, 0.25, 0].map((p) => `<span class="axis-val" style="top:${(1 - p) * 100}%">${p ? esc(moneyShort(top * p)) : "0"}</span>`).join("");
  const cols = list
    .map((h) => {
      const tip = esc(`${h.name}\nInvested ${money(h.invested)}\nCurrent value ${money(h.current)}\n${mkSigned(h.pnl)} (${mkSignPct(h.pct)})`);
      const fill = (v: number, cls: string) => `<span class="col-fill ${cls}" style="height:${v > 0 ? Math.max(2, (v / top) * 100) : 0}%"></span>`;
      return `<button type="button" data-holding="${esc(h.name)}" title="${tip}" aria-label="${tip}"><span class="col-track">${fill(h.invested, "mk-f-inv")}${fill(h.current, h.pnl < 0 ? "mk-f-loss" : "mk-f-cur")}</span><span class="col-name"><span class="col-label">${esc(h.name)}</span></span></button>`;
    })
    .join("");
  box.style.setProperty("--cols", String(Math.min(12, Math.max(list.length, 6))));
  // The axis is only as wide as its values need (the Expense bars keep a fixed 48px)
  const axisW = Math.max(34, Math.max(...[1, 0.75, 0.5, 0.25].map((p) => moneyShort(top * p).length)) * 6 + 12);
  box.style.setProperty("--axis", `${axisW}px`);
  box.innerHTML = `<div class="axis-col yaxis"><div class="axis-plot">${axis}</div></div>${cols}<div class="axis-col filler"><div class="axis-plot"></div></div>`;
}

/* ---- Holdings table ---- */

type ColumnType = "text" | "qty" | "price" | "money" | "signed" | "pct" | "share" | "lt";
type HoldingColumn = [keyof Holding, string, ColumnType];

const MK_COLUMNS: HoldingColumn[] = [
  ["name", "Holding", "text"],
  ["qty", "Units", "qty"],
  ["avg", "Avg cost", "price"],
  ["invested", "Invested", "money"],
  ["ltp", "LTP", "price"],
  ["current", "Current value", "money"],
  ["pnl", "Profit / loss", "signed"],
  ["pct", "P/L %", "pct"],
  ["xirr", "XIRR", "pct"],
  ["share", "Share", "share"],
  ["ltQty", "Held > 1 year", "lt"],
];

// The Holdings card: title, Instrument filter row (like the calendar's) and
// the table itself, which is the only part redrawn on a sort or a filter.
function mkTableHtml(): string {
  return `<div class="graphtitle"><b>Holdings</b></div>
    <div class="small">Quantity and cost from your orders, price from the holdings sheet. Click a column to sort, a row to see its buys.</div>
    <div class="filters chart-filters" id="mkhBar">
      <div class="field"><span class="small field-label" id="mkhInstLabel">Instrument</span>
        <div id="mkhInstMulti" class="multi">
          <button type="button" id="mkhInstToggle" aria-labelledby="mkhInstLabel mkhInstToggle">All selected ▾</button>
          <div id="mkhInstMenu" class="multi-menu"></div>
        </div>
      </div>
      <button type="button" id="mkhReset">Reset</button>
    </div>
    <div id="mkhBody"></div>`;
}

let mkhMenu: MultiSelect | null = null;
let mkhChoice: string[] | null = null; // ticked instruments, kept when the page is redrawn

function setupMkTableFilter(): void {
  const values = [...new Set(marketSummary().held.map((h) => h.category))].sort((a, b) => a.localeCompare(b));
  mkhMenu = createMultiSelect({
    menuId: "mkhInstMenu",
    toggleId: "mkhInstToggle",
    cls: "mkhInstCheck",
    values,
    onChange: () => {
      mkhChoice = mkhMenu!.values();
      drawMkTable();
    },
  });
  const kept = mkhChoice?.filter((v) => values.includes(v)) ?? [];
  if (kept.length) mkhMenu.setValues(kept);
  wireMultiToggles(["mkhInstMulti"]);
  $("mkhReset").onclick = () => {
    mkhChoice = null;
    setupMkTableFilter();
  };
  drawMkTable();
}

function drawMkTable(): void {
  $("mkhBody").innerHTML = mkTableBodyHtml(marketSummary(), mkhMenu ? mkhMenu.set() : null);
}

// The holdings table shows plain numbers: no currency symbol
const mkPlain = (text: string): string => text.replace(/[^\d.,+\-−]/g, "");

function mkTableBodyHtml(s: MarketSummary, instruments: Set<string> | null): string {
  const key = mkState.sortKey as keyof Holding;
  const shown = instruments ? s.held.filter((h) => instruments.has(h.category)) : s.held;
  if (!shown.length) return NO_DATA_HTML;
  const filtered = instruments !== null && instruments.size < new Set(s.held.map((h) => h.category)).size;
  const rows = [...shown].sort((a, b) => {
    const x = a[key] as string | number | null;
    const y = b[key] as string | number | null;
    // Empty values (no price, no XIRR) go last in either direction. They
    // used to be -Infinity, and -Infinity - -Infinity is NaN, which broke
    // the sort whenever two holdings had no value.
    if (x == null || y == null) return (x == null ? 1 : 0) - (y == null ? 1 : 0);
    return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * mkState.sortDir;
  });
  const cell = (h: Holding, [k, , type]: HoldingColumn): string => {
    // Text columns hold strings, every other column a number (or null)
    const v = h[k] as never;
    switch (type) {
      case "text":
        // The name is a button, so a holding's buys can be opened from the keyboard too
        return k === "name" ? `<button type="button" class="mk-link" data-holding="${esc(v)}" title="${esc(v)}">${esc(v)}</button>` : esc(v);
      case "qty":
        return esc(Math.round(v).toLocaleString(CONFIG.locale)); // whole units in this table
      case "price":
        return v === null ? `<span class="small">no price</span>` : esc(mkPlain(mkPrice(v)));
      case "money":
        return esc(mkPlain(money(v)));
      case "signed":
        return `<span class="${mkCls(v)}">${esc(mkPlain(mkSigned(v)))}</span>`;
      case "pct":
        return v === null ? "–" : `<span class="${mkPctCls(v)}">${esc(mkSignPct(v))}</span>`;
      case "share":
        return esc(mkPct(v));
      case "lt":
        return h.qty ? esc(mkPct((v as number) / h.qty, 0)) : "–";
    }
    return "";
  };
  const head = MK_COLUMNS.map(
    // Same header as the Expense transactions table: the whole cell sorts,
    // and the two-triangle icon lights the direction (see .sortarrow)
    (c) => {
      const on = c[0] === key;
      return `<th scope="col" class="mk-sortable ${c[2] === "text" ? "" : "num"}" data-sort="${c[0]}" data-dir="${on ? (mkState.sortDir < 0 ? "desc" : "asc") : ""}" aria-sort="${on ? (mkState.sortDir < 0 ? "descending" : "ascending") : "none"}"><button type="button" class="sorthead"><span class="sortname">${esc(c[1])}</span><span class="sortarrow" aria-hidden="true"></span></button></th>`;
    },
  ).join("");
  const body = rows
    .map(
      (h) => `<tr data-holding="${esc(h.name)}">${MK_COLUMNS.map((c) => `<td class="${c[2] === "text" ? "" : "num"}">${cell(h, c)}</td>`).join("")}</tr>`,
    )
    .join("");
  // Total of the holdings shown (with every instrument ticked: the whole portfolio)
  const invested = filtered ? shown.reduce((t, h) => t + h.invested, 0) : s.invested;
  const current = filtered ? shown.reduce((t, h) => t + h.current, 0) : s.current;
  const pnl = current - invested;
  const share = filtered ? shown.reduce((t, h) => t + h.share, 0) : 1;
  const xirr = filtered
    ? mkXirr([...s.all.filter((h) => instruments!.has(h.category)).flatMap((h) => h.flows), { d: mkToday(), v: current }])
    : s.xirr;
  const p = invested ? pnl / invested : 0;
  return `<div class="mk-tablewrap"><table class="mk-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td>Total</td><td></td><td></td><td class="num">${esc(mkPlain(money(invested)))}</td><td></td><td class="num">${esc(mkPlain(money(current)))}</td><td class="num ${mkCls(pnl)}">${esc(mkPlain(mkSigned(pnl)))}</td><td class="num ${mkPctCls(p)}">${esc(mkSignPct(p))}</td><td class="num">${esc(mkPct(xirr))}</td><td class="num">${esc(mkPct(share))}</td><td></td></tr></tfoot>
    </table></div>`;
}

/* ---- Buy history of one holding ---- */

// Shell of the card: title, the generic filter row (Year, Holding, Order, Reset)
// and a body that scrolls. The body is redrawn by drawMkHistory().
function mkHistoryHtml(): string {
  const field = (id: string, label: string) =>
    `<div class="field"><span class="small field-label" id="mkb${id}Label">${label}</span>` +
    `<div id="mkb${id}Multi" class="multi"><button type="button" id="mkb${id}Toggle" aria-labelledby="mkb${id}Label mkb${id}Toggle">All selected ▾</button>` +
    `<div id="mkb${id}Menu" class="multi-menu"></div></div></div>`;
  return `<div><div class="graphtitle"><b>Buy history</b></div><div class="small">Every order of one holding. "vs last buy" is the price change from the buy before it: red = paid more, green = paid less.</div></div>
    <div class="filters chart-filters">${field("Year", "Year")}${field("Hold", "Holding")}${field("Order", "Order")}<button type="button" id="mkbReset">Reset</button></div>
    <div id="mkbBody" class="mk-hbody"></div>`;
}

let mkbYearMenu: MultiSelect | null = null;
let mkbHoldMenu: MultiSelect | null = null;
let mkbOrderMenu: MultiSelect | null = null;
let mkbYears: string[] | null = null; // ticked years, kept when the page is redrawn

const mkbYearsOf = (holding: string): string[] => [...new Set(data().orders.filter((o) => o.holding === holding).map((o) => o.date.slice(0, 4)))].sort().reverse();

// The year dropdown follows the holding, so it is rebuilt when the holding changes
function mkbBuildYears(keep: string[] | null): void {
  const values = mkbYearsOf(mkState.holding!);
  mkbYearMenu = createMultiSelect({
    menuId: "mkbYearMenu",
    toggleId: "mkbYearToggle",
    cls: "mkbYearCheck",
    values,
    onChange: () => {
      mkbYears = mkbYearMenu!.values();
      drawMkHistory();
    },
  });
  const kept = keep?.filter((y) => values.includes(y)) ?? [];
  if (kept.length) mkbYearMenu.setValues(kept);
}

function setupMkHistory(): void {
  const names = [...data().orders.reduce((m, o) => m.add(o.holding), new Set<string>())].sort((a, b) => a.localeCompare(b));
  mkbHoldMenu = createMultiSelect({
    menuId: "mkbHoldMenu",
    toggleId: "mkbHoldToggle",
    cls: "mkbHoldCheck",
    values: names,
    limit: 1,
    headerLabel: "",
    onChange: () => {
      const chosen = mkbHoldMenu!.values()[0];
      if (chosen) mkState.holding = chosen;
      mkState.histOpen = null;
      mkbYears = null;
      mkbBuildYears(null);
      drawMkHistory();
    },
  });
  mkbHoldMenu.setValues([mkState.holding!]);
  mkbOrderMenu = createMultiSelect({ menuId: "mkbOrderMenu", toggleId: "mkbOrderToggle", cls: "mkbOrderCheck", values: ["Buy", "Sell"], onChange: drawMkHistory });
  mkbBuildYears(mkbYears);
  wireMultiToggles(["mkbYearMulti", "mkbHoldMulti", "mkbOrderMulti"]);
  $("mkbReset").onclick = () => {
    mkbYears = null;
    mkState.histOpen = null;
    mkState.holding = [...marketSummary().held].sort((a, b) => b.current - a.current)[0]?.name || mkState.holding;
    setupMkHistory();
  };
  drawMkHistory();
}

function drawMkHistory(): void {
  const box = $("mkbBody");
  const name = mkState.holding!;
  const all = data().orders.filter((o) => o.holding === name);
  const yearsOn = mkbYearMenu!.set();
  const types = mkbOrderMenu!.set();
  const list = all.filter((o) => yearsOn.has(o.date.slice(0, 4)) && types.has(o.type));
  if (!list.length) {
    box.innerHTML = `<div class="nodata small">No orders for this choice.</div>`;
    return;
  }

  // Change vs the previous buy of this holding (all years)
  const change = new Map<MarketOrder, number>();
  let prev: MarketOrder | null = null;
  for (const o of all) {
    if (o.type !== "Buy") continue;
    if (prev) change.set(o, o.price / prev.price - 1);
    prev = o;
  }

  // Table grouped by year: newest year open, the others folded until opened
  const byYear = new Map<string, MarketOrder[]>();
  list.forEach((o) => {
    const y = o.date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(o);
  });
  if (!mkState.histOpen) mkState.histOpen = new Set([[...byYear.keys()].sort().pop()!]);
  const sums = (arr: MarketOrder[]) => {
    const buys = arr.filter((o) => o.type === "Buy");
    const qty = buys.reduce((t, o) => t + o.units, 0);
    const val = buys.reduce((t, o) => t + o.value, 0);
    return `<td class="num">${esc(mkQty(qty))}</td><td class="num">${qty ? esc(mkPrice(val / qty)) : "–"}</td><td></td>`;
  };
  let rowsHtml = "";
  for (const [y, arr] of byYear) {
    const open = mkState.histOpen.has(y);
    rowsHtml += `<tr class="mk-h-year"><td><button type="button" class="mk-fold" data-hy-toggle="${y}" aria-expanded="${open}" aria-label="${open ? "Fold" : "Unfold"} ${y}">${open ? "−" : "+"}</button> ${y}</td>${sums(arr)}</tr>`;
    if (open) {
      rowsHtml += arr
        .map((o) => {
          const c = change.get(o);
          return `<tr><td class="mk-hchild">${esc(mkDate(o.date))}${o.type === "Sell" ? ' <span class="mk-selltag">Sell</span>' : ""}</td><td class="num">${esc(mkQty(o.units))}</td><td class="num">${esc(mkPrice(o.price))}</td><td class="num ${c === undefined ? "" : c > 0 ? "mk-dear" : "mk-cheap"}">${c === undefined ? "" : esc(mkSignPct(c).replace("+", ""))}</td></tr>`;
        })
        .join("");
    }
  }
  box.innerHTML = `<div class="mk-hchart">${mkHistoryChart(list)}</div>
    <div class="mk-scroll"><table class="mk-table mk-htable-sticky">
      <thead><tr><th>Date</th><th class="num">Qty</th><th class="num">Unit avg</th><th class="num">vs last buy</th></tr>
        <tr class="mk-pin mk-h-total"><th>${esc(name)}</th>${sums(list).replace(/<td/g, "<th").replace(/<\/td>/g, "</th>")}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>`;
}

// Bars = units bought (right axis), line = price paid (left axis)
function mkHistoryChart(list: MarketOrder[]): string {
  if (!list.length) return "";
  const W = 760;
  const H = 300;
  const R = 36;
  const T = 14;
  const B = 34;
  const ph = H - T - B;
  const prices = list.map((o) => o.price);
  let pMin = Math.min(...prices);
  let pMax = Math.max(...prices);
  const pad = (pMax - pMin) * 0.15 || pMax * 0.05 || 1;
  pMin = Math.max(0, pMin - pad);
  pMax += pad;
  const qMax = Math.max(...list.map((o) => o.units)) * 1.1;
  // Left margin just wide enough for the price labels (no empty strip)
  // Price labels: the short form (₹2.6K) unless neighbouring labels would read the same
  // (a narrow price range); then whole rupees, and two decimals for a tiny range.
  const ticks = [0, 1, 2, 3, 4].map((k) => pMax - ((pMax - pMin) * k) / 4);
  const labelSets = [ticks.map((t) => moneyShort(t)), ticks.map((t) => Math.round(t).toLocaleString(CONFIG.locale)), ticks.map((t) => t.toLocaleString(CONFIG.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))];
  const priceLabels = labelSets.find((set) => new Set(set).size === set.length) ?? labelSets[2]!;
  const L = Math.max(...priceLabels.map((t) => t.length)) * 6.2 + 10;
  const pw = W - L - R;
  const step = pw / list.length;
  const xOf = (i: number) => L + step * (i + 0.5);
  const yP = (p: number) => T + ph - ((p - pMin) / (pMax - pMin)) * ph;
  const yQ = (q: number) => T + ph - (q / qMax) * ph;
  const bw = Math.max(3, Math.min(16, step * 0.5));
  let svg = "";
  for (let k = 0; k <= 4; k++) {
    const y = T + (ph * k) / 4;
    const q = qMax - (qMax * k) / 4;
    svg += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#e2e8f0"></line>`;
    svg += `<text x="${L - 6}" y="${y + 4}" text-anchor="end" class="mk-axis">${esc(priceLabels[k]!)}</text>`;
    svg += `<text x="${W - R + 6}" y="${y + 4}" class="mk-axis">${esc(mkQty(Math.round(q)))}</text>`;
  }
  list.forEach((o, i) => {
    const y = yQ(o.units);
    svg += `<rect x="${(xOf(i) - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(T + ph - y).toFixed(1)}" rx="2" fill="${o.type === "Sell" ? "#fca5a5" : "#fcd34d"}"><title>${esc(`${mkDate(o.date)} · ${o.type} ${mkQty(o.units)} at ${mkPrice(o.price)}`)}</title></rect>`;
  });
  const pts = list.map((o, i) => `${xOf(i).toFixed(1)},${yP(o.price).toFixed(1)}`).join(" ");
  svg += `<polyline points="${pts}" fill="none" stroke="#f97316" stroke-width="2"></polyline>`;
  if (list.length <= 80) {
    list.forEach((o, i) => {
      svg += `<circle cx="${xOf(i).toFixed(1)}" cy="${yP(o.price).toFixed(1)}" r="3.5" fill="#f97316"><title>${esc(`${mkDate(o.date)} · ${mkPrice(o.price)}`)}</title></circle>`;
    });
  }
  // A few date labels along the bottom
  const every = Math.ceil(list.length / 8);
  list.forEach((o, i) => {
    if (i % every === 0) svg += `<text x="${xOf(i).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="mk-axis">${esc(`${CONFIG.months[Number(o.date.slice(5, 7)) - 1]} ${o.date.slice(2, 4)}`)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="mk-hsvg" role="img" aria-label="Price paid and units bought per order">${svg}</svg>
    <div class="legend mk-hkey"><span class="legend-btn"><span class="legend-swatch" style="background:#f97316"></span>Price paid (left)</span><span class="legend-btn"><span class="legend-swatch" style="background:#fcd34d"></span>Units bought (right)</span></div>`;
}

/* ---- Dividends ---- */

// The dividends are Income rows: Category "Dividend", Particulars
// "Dividend: HOLDING". Only rows in the chosen currency are counted, like the
// Income page. Rows that do not follow the pattern are counted as skipped.
const MK_DIVIDEND = /^\s*dividend\s*:\s*(.+?)\s*$/i;

function mkDividendList(): { list: Dividend[]; skipped: number } {
  const list: Dividend[] = [];
  let skipped = 0;
  for (const r of moduleData.income?.records ?? []) {
    if (r.Currency !== activeCurrency || r.Category.trim().toLowerCase() !== "dividend") continue;
    const m = MK_DIVIDEND.exec(r.Particular);
    if (m && r.Amount) list.push({ date: r.Date, holding: m[1]!, amount: r.Amount });
    else if (!m) skipped++;
  }
  return { list, skipped };
}

// Years of the pivot: newest first in the dropdown, at most CONFIG.maxCompareYears ticked
let mkdMenu: MultiSelect | null = null;
let mkdChoice: string[] | null = null;

function mkDividendsHtml(): string {
  const { list, skipped } = mkDividendList();
  if (!list.length) {
    return `<div class="graphtitle"><b>Dividends</b></div>
      <div class="nodata small">No dividends found. In the Income sheet, add one row per dividend with Category <b>Dividend</b> and Particulars written as <b>Dividend: HOLDING</b> (for example Dividend: TCS), and they will show here by month and by holding.${
        skipped ? ` ${skipped} Income row${skipped === 1 ? "" : "s"} with Category Dividend did not follow that pattern.` : ""
      }</div>`;
  }
  const byMonth = mkState.divBy === "month";
  return `<div><div class="graphtitle"><b>Dividends</b></div><div class="small">From the Income sheet, in ${esc(activeCurrency)}. Click − / + to fold a group.</div></div>
    <div class="filters chart-filters">
      <div class="field"><span class="small field-label" id="mkdYearLabel">Years</span>
        <div id="mkdYearMulti" class="multi">
          <button type="button" id="mkdYearToggle" aria-labelledby="mkdYearLabel mkdYearToggle">All selected ▾</button>
          <div id="mkdYearMenu" class="multi-menu"></div>
        </div>
      </div>
      <button type="button" id="mkdReset">Reset</button>
    </div>
    <div class="mk-togglerow"><div class="ov-period" role="group" aria-label="Group by">
        <button type="button" data-div-by="month" class="${byMonth ? "on" : ""}" aria-pressed="${byMonth}">Month › Holding</button>
        <button type="button" data-div-by="holding" class="${byMonth ? "" : "on"}" aria-pressed="${!byMonth}">Holding › Month</button>
    </div></div>
    <div id="mkdBody" class="mk-hbody"></div>`;
}

function setupMkDividends(): void {
  if (!document.getElementById("mkdBody")) return; // no dividends to show
  const { list } = mkDividendList();
  const values = [...new Set(list.map((d) => d.date.slice(0, 4)))].sort().reverse(); // newest first
  mkdMenu = createMultiSelect({
    menuId: "mkdYearMenu",
    toggleId: "mkdYearToggle",
    cls: "mkdYearCheck",
    values,
    limit: CONFIG.maxCompareYears,
    headerLabel: `Latest ${CONFIG.maxCompareYears}`,
    latestOnly: true,
    onChange: () => {
      mkdChoice = mkdMenu!.values();
      drawMkDividends();
    },
  });
  const kept = mkdChoice?.filter((y) => values.includes(y)) ?? [];
  if (kept.length) mkdMenu.setValues(kept);
  wireMultiToggles(["mkdYearMulti"]);
  $("mkdReset").onclick = () => {
    mkdChoice = null;
    setupMkDividends();
  };
  drawMkDividends();
}

// A change of grouping or fold: redraw the table only (the years filter stays)
function redrawMkDividends(): void {
  $("mkDividends")
    .querySelectorAll<HTMLElement>("[data-div-by]")
    .forEach((b) => {
      const on = b.dataset.divBy === mkState.divBy;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
  drawMkDividends();
}

function drawMkDividends(): void {
  const box = $("mkdBody");
  const { list: all, skipped } = mkDividendList();
  const years = (mkdMenu ? [...mkdMenu.values()] : []).sort(); // oldest to newest
  if (!years.length) {
    box.innerHTML = `<div class="nodata small">Pick at least one year.</div>`;
    return;
  }
  const list = all.filter((d) => years.includes(d.date.slice(0, 4)));
  const byMonth = mkState.divBy === "month";
  const groupOf = (d: Dividend): string | number => (byMonth ? Number(d.date.slice(5, 7)) - 1 : d.holding);
  const childOf = (d: Dividend): string | number => (byMonth ? d.holding : Number(d.date.slice(5, 7)) - 1);
  const label = (v: string | number): string => (typeof v === "number" ? CONFIG.months[v]! : v);
  type ByYear = Record<string, number>;
  const groups = new Map<string | number, Map<string | number, ByYear>>();
  for (const d of list) {
    const g = groupOf(d);
    const c = childOf(d);
    const y = d.date.slice(0, 4);
    if (!groups.has(g)) groups.set(g, new Map());
    const kids = groups.get(g)!;
    if (!kids.has(c)) kids.set(c, {});
    const byY = kids.get(c)!;
    byY[y] = (byY[y] || 0) + d.amount;
  }
  const sortKeys = (keys: Iterable<string | number>) => [...keys].sort((a, b) => (typeof a === "number" ? a - (b as number) : String(a).localeCompare(String(b))));
  const cells = (byY: ByYear) => {
    const tot = years.reduce((t, y) => t + (byY[y] || 0), 0);
    return years.map((y) => `<td class="num">${byY[y] ? esc(mkPrice(byY[y]).replace(/^[^\d-]+/, "")) : ""}</td>`).join("") + `<td class="num"><b>${esc(mkPrice(tot).replace(/^[^\d-]+/, ""))}</b></td>`;
  };
  let rows = "";
  const grand: ByYear = {};
  for (const g of sortKeys(groups.keys())) {
    const kids = groups.get(g)!;
    const sum: ByYear = {};
    for (const v of kids.values()) for (const y in v) sum[y] = (sum[y] || 0) + v[y]!;
    for (const y in sum) grand[y] = (grand[y] || 0) + sum[y]!;
    const key = `${mkState.divBy}:${g}`;
    const open = !mkState.divOpen.has(key); // all open until closed
    rows += `<tr class="mk-dgroup"><td><button type="button" data-div-toggle="${esc(key)}" aria-expanded="${open}" aria-label="${open ? "Fold" : "Unfold"} ${esc(label(g))}">${open ? "−" : "+"}</button> ${esc(label(g))}</td>${cells(sum)}</tr>`;
    if (open) {
      for (const c of sortKeys(kids.keys())) rows += `<tr><td class="mk-dchild" title="${esc(label(c))}">${esc(label(c))}</td>${cells(kids.get(c)!)}</tr>`;
    }
  }
  // Two tables with the same fixed column widths: the rows scroll in the first, the Total
  // sits under them in the second. (A sticky Total inside the scrolling table drew rows
  // under it on some screens.) Both sit in one wrapper that scrolls sideways when narrow.
  const colgroup = `<colgroup><col style="width:130px">${years.map(() => "<col>").join("")}<col style="width:112px"></colgroup>`;
  const minW = 130 + 112 + years.length * 92;
  box.innerHTML = `<div class="mk-dwrap"><div class="mk-dinner" style="min-width:${minW}px">
      <div class="mk-dbody"><table class="mk-table mk-dtable">${colgroup}
        <thead><tr><th>${byMonth ? "Month" : "Holding"}</th>${years.map((y) => `<th class="num">${y}</th>`).join("")}<th class="num">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="mk-dfoot"><table class="mk-table mk-dtable">${colgroup}<tbody><tr><td>Total</td>${cells(grand)}</tr></tbody></table></div>
    </div></div>${
      skipped ? `<div class="small mk-foot">${skipped} Income row${skipped === 1 ? "" : "s"} with Category Dividend ${skipped === 1 ? "was" : "were"} skipped: Particulars must read Dividend: HOLDING.</div>` : ""
    }`;
}

/* ------------ Page switching and clicks ------------ */

// Side bar badge: number of holdings
export function updateMarketCount(): void {
  const el = document.querySelector("[data-count='market']");
  if (el) el.textContent = marketData ? String(marketSummary().held.length) : "";
}

export function selectMarket(): void {
  showPage("market");
  // The market sheets carry no currency column: amounts are in the default one
  $("currency").hidden = true;
  setActiveCurrency(CONFIG.currency);
  setMoneyCurrency(CONFIG.currency);
  renderMarket();
}

function mkShowHolding(name: string): void {
  mkState.holding = name;
  mkState.histOpen = null;
  mkbYears = null;
  setupMkHistory();
  $("mkHistory").scrollIntoView({ behavior: "smooth", block: "start" });
}

export function setupMarket(): void {
  document.querySelectorAll<HTMLElement>(".side-item[data-page='market']").forEach((b) => {
    b.onclick = () => {
      if (activePage === "market") return;
      selectMarket();
      window.scrollTo({ top: 0 });
    };
  });
  const body = $("mkBody");
  body.addEventListener("click", (e) => {
    // A click anywhere in a table heading cell sorts (not only on its text)
    const target = e.target as Element;
    const t = target.closest<HTMLElement>("th[data-sort]") ?? target.closest<HTMLElement>("button, tr[data-holding]");
    if (!t) return;
    const d = t.dataset;
    if (d.day) {
      const day = d.day;
      const list = data().orders.filter((o) => o.date === day);
      $("mkDayInfo").innerHTML = `<b>${esc(mkDate(d.day))}</b>: ${list
        .map((o) => `${esc(o.type)} ${esc(mkQty(o.units))} <button type="button" class="mk-link" data-holding="${esc(o.holding)}">${esc(o.holding)}</button> at ${esc(mkPrice(o.price))} (${esc(money(o.value))})`)
        .join("; ")}`;
    } else if (d.tree) {
      mkState.treeBy = d.tree as "invested" | "current";
      drawMkTree();
    } else if (d.sort) {
      if (mkState.sortKey === d.sort) mkState.sortDir *= -1;
      else {
        mkState.sortKey = d.sort;
        mkState.sortDir = ["name", "category"].includes(d.sort) ? 1 : -1;
      }
      drawMkTable();
    } else if (d.hyToggle) {
      const open = mkState.histOpen ?? new Set<string>();
      if (open.has(d.hyToggle)) open.delete(d.hyToggle);
      else open.add(d.hyToggle);
      mkState.histOpen = open;
      drawMkHistory();
    } else if (d.divBy) {
      mkState.divBy = d.divBy as "month" | "holding";
      redrawMkDividends();
    } else if (d.divToggle) {
      if (mkState.divOpen.has(d.divToggle)) mkState.divOpen.delete(d.divToggle);
      else mkState.divOpen.add(d.divToggle);
      redrawMkDividends();
    } else if (d.holding) {
      mkShowHolding(d.holding);
    }
  });
  // Treemap boxes depend on the width
  let timer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    if (activePage !== "market" || !marketData) return;
    clearTimeout(timer);
    timer = setTimeout(() => mkLayoutTreemap(marketSummary()), 150);
  });
}
