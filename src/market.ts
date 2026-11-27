import { CONFIG } from "./config";
import { excelDate, parseAmount } from "./cellValues";
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
import { $, emptyCardHtml, esc, money, moneyShort, moneySign, setMoneyCurrency, signedMoney, todayIso } from "./utils";

/* =========================================================================
market.ts
The Market page (#marketPage): shares, ETFs and mutual funds.

Reads up to three tables, found by their HEADINGS (sheet names do not
matter, so they may sit in the finance workbook or in a separate file):

  Orders (required) .... Date, Order (Buy/Sell), Holding, Units, UnitAvg;
                         optional LotValue, Charges, IndexValue, EqCumUnits
  Holdings (optional) .. Holding plus LTP (latest price); optional Category,
                         Sector, SubSector. Gives the current prices.
  Dividends (optional) . Date, Holding, Amount (or Dividend)

Quantity, average cost and invested amount are worked out from the orders
(average-cost method, as in the sheet's CurrentInv / SoldInv columns), so a
holdings table that is a few days old still shows the latest buys. Only the
price (LTP) and the category come from the holdings table.
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
  category: string;
  treeBy: "invested" | "current";
  sortKey: string;
  sortDir: number;
  holding: string | null;
  years: Set<string> | null;
  orderType: "All" | "Buy" | "Sell";
  divBy: "month" | "holding";
  divOpen: Set<string>;
} = {
  calYear: null,
  category: "All", // bars + treemap filter
  treeBy: "invested", // "invested" | "current"
  sortKey: "current",
  sortDir: -1,
  holding: null, // buy history
  years: null, // Set of years shown in buy history (null = all)
  orderType: "All",
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
  const dividends: Dividend[] = [];
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
          category: txt("category") || "Other",
          sector: txt("sector"),
          subSector: txt("subsector"),
          ltp: mkNum(row[c.ltp!]),
          qty: c.qty === undefined ? null : mkNum(row[c.qty]),
          avg: c.avg === undefined ? null : mkNum(row[c.avg]),
        });
      }
      continue;
    }
    // Dividends
    h = mkFindHeader(grid, ["date", "holding", "amount|dividend"]);
    if (h && h.cols.units === undefined) {
      sheetNames.push(name);
      const c = h.cols;
      const amtCol = (c.amount ?? c.dividend)!;
      for (let r = h.row + 1; r < grid.length; r++) {
        const row = grid[r];
        if (!row) continue;
        const date = mkIso(row[c.date!]);
        const holding = String(row[c.holding!] ?? "").trim();
        const amount = mkNum(row[amtCol]);
        if (date && holding && amount) dividends.push({ date, holding, amount });
      }
    }
  }
  if (!orders.length) return null;
  orders.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { orders, info, dividends, skipped, sheetNames };
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
    ${mkCalendar()}
    <section class="card card-gap" id="mkTreeCard">${mkTreemapHtml(s)}</section>
    <section class="card card-gap" id="mkBarsCard">${mkBarsHtml(s)}</section>
    <section class="card card-gap" id="mkTableCard">${mkTableHtml(s)}</section>
    <section class="card card-gap" id="mkHistory">${mkHistoryHtml(s)}</section>
    <section class="card card-gap" id="mkDividends">${mkDividendsHtml()}</section>`;
  mkLayoutTreemap(s);
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

function mkCalendar(): string {
  const byDay = new Map<string, { buy: number; sell: number; list: MarketOrder[] }>();
  for (const o of data().orders) {
    const e = byDay.get(o.date) || { buy: 0, sell: 0, list: [] };
    e[o.type === "Buy" ? "buy" : "sell"] += o.value;
    e.list.push(o);
    byDay.set(o.date, e);
  }
  const years = [...new Set(data().orders.map((o) => Number(o.date.slice(0, 4))))];
  if (mkState.calYear === null || !years.includes(mkState.calYear)) mkState.calYear = years[years.length - 1]!;
  const y = mkState.calYear;

  // Colour steps from the buy amounts of every day
  const amounts = [...byDay.values()].map((e) => e.buy).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p: number) => amounts[Math.min(amounts.length - 1, Math.floor(p * amounts.length))] || 0;
  const steps = [q(0.5), q(0.8), q(0.95)];
  const level = (v: number) => (v <= steps[0] ? 1 : v <= steps[1] ? 2 : v <= steps[2] ? 3 : 4);

  const months = CONFIG.months.map((mName, m) => {
    const first = new Date(Date.UTC(y, m, 1));
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    let total = 0;
    let cells = "";
    for (let i = 0; i < first.getUTCDay(); i++) cells += `<span class="mk-day mk-blank"></span>`;
    for (let day = 1; day <= days; day++) {
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const e = byDay.get(iso);
      if (!e) {
        cells += `<span class="mk-day"></span>`;
        continue;
      }
      total += e.buy - e.sell;
      const tip = `${mkDate(iso)}: ${e.list.map((o) => `${o.type} ${mkQty(o.units)} ${o.holding} ${money(o.value)}`).join("; ")}`;
      cells += `<button type="button" class="mk-day ${e.buy ? `mk-l${level(e.buy)}` : ""}${e.sell ? " mk-sell" : ""}" data-day="${iso}" title="${esc(tip)}" aria-label="${esc(tip)}"></button>`;
    }
    return `<div class="mk-month"><div class="mk-mhead"><b>${mName}</b><span>${total ? esc(money(total)) : ""}</span></div><div class="mk-grid">${cells}</div></div>`;
  });

  return `<section class="card card-gap" id="mkCalendar">
    <div class="ov-head">
      <div><div class="graphtitle"><b>Investment calendar</b></div><div class="small">Money put in each day; the month's net total on top. Click a day for its orders.</div></div>
      <div class="ov-period mk-years" role="group" aria-label="Year">${years
        .map((yr) => `<button type="button" data-cal-year="${yr}" class="${yr === y ? "on" : ""}" aria-pressed="${yr === y}">${yr}</button>`)
        .join("")}</div>
    </div>
    <div class="mk-cal">${months.join("")}</div>
    <div class="mk-cal-foot">
      <div class="mk-legend small">Less <span class="mk-day mk-l1"></span><span class="mk-day mk-l2"></span><span class="mk-day mk-l3"></span><span class="mk-day mk-l4"></span> More <span class="mk-day mk-sell"></span> Sell</div>
      <div class="small" id="mkDayInfo"></div>
    </div>
  </section>`;
}

/* ---- Category chips (treemap + bars) ---- */

function mkCategoryChips(s: MarketSummary): string {
  const cats = ["All", ...new Set(s.held.map((h) => h.category))];
  return `<div class="mk-chips" role="group" aria-label="Category">${cats
    .map((c) => `<button type="button" class="mk-chip${c === mkState.category ? " on" : ""}" data-cat="${esc(c)}" aria-pressed="${c === mkState.category}">${c === "All" ? "All" : `<span class="ov-sw" style="background:${mkCatColor(c)}"></span>${esc(c)}`}</button>`)
    .join("")}</div>`;
}

const mkFiltered = (s: MarketSummary): Holding[] => (mkState.category === "All" ? s.held : s.held.filter((h) => h.category === mkState.category));

/* ---- Treemap ---- */

function mkTreemapHtml(s: MarketSummary): string {
  return `<div class="ov-head">
      <div><div class="graphtitle"><b>Portfolio map</b></div><div class="small">Each box is a holding, sized by its ${mkState.treeBy === "invested" ? "invested amount" : "current value"}. Click one to see its buys.</div></div>
      <div class="ov-period" role="group" aria-label="Size by">
        <button type="button" data-tree="invested" class="${mkState.treeBy === "invested" ? "on" : ""}">Invested</button>
        <button type="button" data-tree="current" class="${mkState.treeBy === "current" ? "on" : ""}">Current value</button>
      </div>
    </div>
    ${mkCategoryChips(s)}
    <div class="mk-tree" id="mkTree"></div>`;
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
  const list = mkFiltered(s);
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

function mkBarsHtml(s: MarketSummary): string {
  const list = [...mkFiltered(s)].sort((a, b) => b.invested - a.invested);
  const top = Math.max(1, ...list.map((h) => Math.max(h.invested, h.current)));
  const bars = list
    .map(
      (h) => `<button type="button" class="mk-col" data-holding="${esc(h.name)}" title="${esc(`${h.name}\nInvested ${money(h.invested)}\nCurrent value ${money(h.current)}\n${mkSigned(h.pnl)} (${mkSignPct(h.pct)})`)}">
        <span class="mk-colbars"><span class="mk-bar mk-b-inv" style="height:${((h.invested / top) * 100).toFixed(1)}%"></span><span class="mk-bar mk-b-cur ${h.pnl < 0 ? "down" : ""}" style="height:${((h.current / top) * 100).toFixed(1)}%"></span></span>
        <span class="mk-collabel">${esc(h.name)}</span>
      </button>`,
    )
    .join("");
  return `<div class="ov-head">
      <div><div class="graphtitle"><b>Invested vs current value</b></div><div class="small">Per holding, largest investment first</div></div>
      <div class="ov-key"><span><span class="ov-sw" style="background:#93c5fd"></span>Invested</span><span><span class="ov-sw" style="background:#2563eb"></span>Current (gain)</span><span><span class="ov-sw" style="background:#f59e0b"></span>Current (loss)</span></div>
    </div>
    ${mkCategoryChips(s)}
    <div class="ov-scroll"><div class="mk-cols">${bars}</div></div>`;
}

/* ---- Holdings table ---- */

type ColumnType = "text" | "qty" | "price" | "money" | "signed" | "pct" | "share" | "lt";
type HoldingColumn = [keyof Holding, string, ColumnType];

const MK_COLUMNS: HoldingColumn[] = [
  ["name", "Holding", "text"],
  ["category", "Category", "text"],
  ["qty", "Qty", "qty"],
  ["avg", "Avg cost", "price"],
  ["invested", "Invested", "money"],
  ["ltp", "LTP", "price"],
  ["current", "Current value", "money"],
  ["pnl", "Profit / loss", "signed"],
  ["pct", "P/L %", "pct"],
  ["share", "Share", "share"],
  ["ltQty", "Held > 1 year", "lt"],
  ["xirr", "XIRR", "pct"],
];

function mkTableHtml(s: MarketSummary): string {
  const key = mkState.sortKey as keyof Holding;
  const rows = [...s.held].sort((a, b) => {
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
        if (k === "category") return `<span class="ov-sw" style="background:${mkCatColor(v)}"></span>${esc(v)}`;
        // The name is a button, so a holding's buys can be opened from the keyboard too
        return k === "name" ? `<button type="button" class="mk-link" data-holding="${esc(v)}" title="${esc(v)}">${esc(v)}</button>` : esc(v);
      case "qty":
        return esc(mkQty(v));
      case "price":
        return v === null ? `<span class="small">no price</span>` : esc(mkPrice(v));
      case "money":
        return esc(money(v));
      case "signed":
        return `<span class="${mkCls(v)}">${esc(mkSigned(v))}</span>`;
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
    (c) => `<th scope="col" class="${c[2] === "text" ? "" : "num"}"${c[0] === key ? ` aria-sort="${mkState.sortDir < 0 ? "descending" : "ascending"}"` : ""}><button type="button" data-sort="${c[0]}">${esc(c[1])}${c[0] === key ? (mkState.sortDir < 0 ? " ▼" : " ▲") : ""}</button></th>`,
  ).join("");
  const body = rows
    .map(
      (h) => `<tr data-holding="${esc(h.name)}">${MK_COLUMNS.map((c) => `<td class="${c[2] === "text" ? "" : "num"}">${cell(h, c)}</td>`).join("")}</tr>`,
    )
    .join("");
  const p = s.invested ? s.pnl / s.invested : 0;
  return `<div class="graphtitle"><b>Holdings</b></div>
    <div class="small">Quantity and cost from your orders, price from the holdings sheet. Click a column to sort, a row to see its buys.</div>
    <div class="mk-tablewrap"><table class="mk-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td>Total</td><td></td><td></td><td></td><td class="num">${esc(money(s.invested))}</td><td></td><td class="num">${esc(money(s.current))}</td><td class="num ${mkCls(s.pnl)}">${esc(mkSigned(s.pnl))}</td><td class="num ${mkPctCls(p)}">${esc(mkSignPct(p))}</td><td class="num">100%</td><td></td><td class="num">${esc(mkPct(s.xirr))}</td></tr></tfoot>
    </table></div>`;
}

/* ---- Buy history of one holding ---- */

function mkHistoryHtml(s: MarketSummary): string {
  const name = mkState.holding!;
  const all = data().orders.filter((o) => o.holding === name);
  const years = [...new Set(all.map((o) => o.date.slice(0, 4)))];
  const yearsOn = mkState.years && [...mkState.years].some((y) => years.includes(y)) ? mkState.years : new Set(years);
  const list = all.filter((o) => yearsOn.has(o.date.slice(0, 4)) && (mkState.orderType === "All" || o.type === mkState.orderType));

  // Change vs the previous buy of this holding (all years)
  const change = new Map<MarketOrder, number>();
  let prev: MarketOrder | null = null;
  for (const o of all) {
    if (o.type !== "Buy") continue;
    if (prev) change.set(o, o.price / prev.price - 1);
    prev = o;
  }

  const options = [...s.all]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((h) => `<option value="${esc(h.name)}"${h.name === name ? " selected" : ""}>${esc(h.name)}${h.qty > 1e-9 ? "" : " (sold)"}</option>`)
    .join("");

  // Table grouped by year
  let rowsHtml = "";
  const byYear = new Map<string, MarketOrder[]>();
  list.forEach((o) => {
    const y = o.date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(o);
  });
  const sumRow = (label: string, arr: MarketOrder[], cls: string) => {
    const buys = arr.filter((o) => o.type === "Buy");
    const qty = buys.reduce((t, o) => t + o.units, 0);
    const val = buys.reduce((t, o) => t + o.value, 0);
    return `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${esc(mkQty(qty))}</td><td class="num">${qty ? esc(mkPrice(val / qty)) : "–"}</td><td></td></tr>`;
  };
  if (list.length) rowsHtml += sumRow(name, list, "mk-h-total");
  for (const [y, arr] of byYear) {
    rowsHtml += sumRow(y, arr, "mk-h-year");
    rowsHtml += arr
      .map((o) => {
        const c = change.get(o);
        return `<tr><td>${esc(mkDate(o.date))}${o.type === "Sell" ? ' <span class="mk-selltag">Sell</span>' : ""}</td><td class="num">${esc(mkQty(o.units))}</td><td class="num">${esc(mkPrice(o.price))}</td><td class="num ${c === undefined ? "" : c > 0 ? "mk-dear" : "mk-cheap"}">${c === undefined ? "" : esc(mkSignPct(c).replace("+", ""))}</td></tr>`;
      })
      .join("");
  }

  return `<div class="ov-head">
      <div><div class="graphtitle"><b>Buy history</b></div><div class="small">Every order of one holding. "vs last buy" is the price change from the buy before it: red = paid more, green = paid less.</div></div>
      <label class="mk-select"><span class="small">Holding</span><select id="mkHolding">${options}</select></label>
    </div>
    <div class="mk-hfilters">
      <div class="mk-chips" role="group" aria-label="Years">${years
        .map((y) => `<button type="button" class="mk-chip${yearsOn.has(y) ? " on" : ""}" data-hyear="${y}" aria-pressed="${yearsOn.has(y)}">${y}</button>`)
        .join("")}</div>
      <div class="mk-chips" role="group" aria-label="Order">${["All", "Buy", "Sell"]
        .map((t) => `<button type="button" class="mk-chip${mkState.orderType === t ? " on" : ""}" data-otype="${t}" aria-pressed="${mkState.orderType === t}">${t}</button>`)
        .join("")}</div>
    </div>
    <div class="mk-hist">
      <div class="mk-tablewrap mk-htable" tabindex="0" role="region" aria-label="Orders of the chosen holding"><table class="mk-table">
        <thead><tr><th>Date</th><th class="num">Qty</th><th class="num">Unit avg</th><th class="num">vs last buy</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="4" class="small">No orders for this choice.</td></tr>'}</tbody>
      </table></div>
      <div class="mk-hchart">${mkHistoryChart(list)}</div>
    </div>`;
}

// Bars = units bought (right axis), line = price paid (left axis)
function mkHistoryChart(list: MarketOrder[]): string {
  if (!list.length) return "";
  const W = 760;
  const H = 300;
  const L = 64;
  const R = 44;
  const T = 14;
  const B = 34;
  const pw = W - L - R;
  const ph = H - T - B;
  const prices = list.map((o) => o.price);
  let pMin = Math.min(...prices);
  let pMax = Math.max(...prices);
  const pad = (pMax - pMin) * 0.15 || pMax * 0.05 || 1;
  pMin = Math.max(0, pMin - pad);
  pMax += pad;
  const qMax = Math.max(...list.map((o) => o.units)) * 1.1;
  const step = pw / list.length;
  const xOf = (i: number) => L + step * (i + 0.5);
  const yP = (p: number) => T + ph - ((p - pMin) / (pMax - pMin)) * ph;
  const yQ = (q: number) => T + ph - (q / qMax) * ph;
  const bw = Math.max(3, Math.min(16, step * 0.5));
  let svg = "";
  for (let k = 0; k <= 4; k++) {
    const y = T + (ph * k) / 4;
    const p = pMax - ((pMax - pMin) * k) / 4;
    const q = qMax - (qMax * k) / 4;
    svg += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#e2e8f0"></line>`;
    svg += `<text x="${L - 6}" y="${y + 4}" text-anchor="end" class="mk-axis">${esc(moneyShort(p))}</text>`;
    svg += `<text x="${W - R + 6}" y="${y + 4}" class="mk-axis">${esc(mkQty(Math.round(q * 10) / 10))}</text>`;
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
  return `<div class="ov-key mk-hkey"><span><span class="ov-sw" style="background:#f97316"></span>Price paid (left)</span><span><span class="ov-sw" style="background:#fcd34d"></span>Units bought (right)</span></div>
    <svg viewBox="0 0 ${W} ${H}" class="mk-hsvg" role="img" aria-label="Price paid and units bought per order">${svg}</svg>`;
}

/* ---- Dividends ---- */

function mkDividendsHtml(): string {
  const list = data().dividends;
  if (!list.length) {
    return `<div class="graphtitle"><b>Dividends</b></div>
      <div class="nodata small">No dividends found. Add a sheet (in either file) with the headings <b>Date</b>, <b>Holding</b> and <b>Amount</b>, one row per dividend received, and they will show here by month and by holding.</div>`;
  }
  const years = [...new Set(list.map((d) => d.date.slice(0, 4)))].sort();
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
    rows += `<tr class="mk-dgroup"><td><button type="button" data-div-toggle="${esc(key)}" aria-expanded="${open}">${open ? "−" : "+"}</button> ${esc(label(g))}</td>${cells(sum)}</tr>`;
    if (open) {
      for (const c of sortKeys(kids.keys())) rows += `<tr><td class="mk-dchild" title="${esc(label(c))}">${esc(label(c))}</td>${cells(kids.get(c)!)}</tr>`;
    }
  }
  return `<div class="ov-head">
      <div><div class="graphtitle"><b>Dividends</b></div><div class="small">Received per year, in ${esc(activeCurrency)}. Click − / + to fold a group.</div></div>
      <div class="ov-period" role="group" aria-label="Group by">
        <button type="button" data-div-by="month" class="${byMonth ? "on" : ""}">By month</button>
        <button type="button" data-div-by="holding" class="${byMonth ? "" : "on"}">By holding</button>
      </div>
    </div>
    <div class="mk-tablewrap"><table class="mk-table mk-dtable">
      <thead><tr><th>${byMonth ? "Month" : "Holding"}</th>${years.map((y) => `<th class="num">${y}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>Total</td>${cells(grand)}</tr></tfoot>
    </table></div>`;
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
  mkState.years = null;
  mkState.orderType = "All";
  $("mkHistory").innerHTML = mkHistoryHtml(marketSummary());
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
    const t = (e.target as Element).closest<HTMLElement>("button, tr[data-holding]");
    if (!t) return;
    const d = t.dataset;
    if (d.calYear) {
      mkState.calYear = Number(d.calYear);
      $("mkCalendar").outerHTML = mkCalendar();
    } else if (d.day) {
      const day = d.day;
      const list = data().orders.filter((o) => o.date === day);
      $("mkDayInfo").innerHTML = `<b>${esc(mkDate(d.day))}</b>: ${list
        .map((o) => `${esc(o.type)} ${esc(mkQty(o.units))} <button type="button" class="mk-link" data-holding="${esc(o.holding)}">${esc(o.holding)}</button> at ${esc(mkPrice(o.price))} (${esc(money(o.value))})`)
        .join("; ")}`;
    } else if (d.cat) {
      mkState.category = d.cat;
      const s = marketSummary();
      $("mkTreeCard").innerHTML = mkTreemapHtml(s);
      $("mkBarsCard").innerHTML = mkBarsHtml(s);
      mkLayoutTreemap(s);
    } else if (d.tree) {
      mkState.treeBy = d.tree as "invested" | "current";
      const s = marketSummary();
      $("mkTreeCard").innerHTML = mkTreemapHtml(s);
      mkLayoutTreemap(s);
    } else if (d.sort) {
      if (mkState.sortKey === d.sort) mkState.sortDir *= -1;
      else {
        mkState.sortKey = d.sort;
        mkState.sortDir = ["name", "category"].includes(d.sort) ? 1 : -1;
      }
      $("mkTableCard").innerHTML = mkTableHtml(marketSummary());
    } else if (d.hyear) {
      const all = data().orders.filter((o) => o.holding === mkState.holding).map((o) => o.date.slice(0, 4));
      const on = mkState.years ? new Set(mkState.years) : new Set(all);
      if (on.has(d.hyear) && on.size > 1) on.delete(d.hyear);
      else on.add(d.hyear);
      mkState.years = on;
      $("mkHistory").innerHTML = mkHistoryHtml(marketSummary());
    } else if (d.otype) {
      mkState.orderType = d.otype as "All" | "Buy" | "Sell";
      $("mkHistory").innerHTML = mkHistoryHtml(marketSummary());
    } else if (d.divBy) {
      mkState.divBy = d.divBy as "month" | "holding";
      $("mkDividends").innerHTML = mkDividendsHtml();
    } else if (d.divToggle) {
      if (mkState.divOpen.has(d.divToggle)) mkState.divOpen.delete(d.divToggle);
      else mkState.divOpen.add(d.divToggle);
      $("mkDividends").innerHTML = mkDividendsHtml();
    } else if (d.holding) {
      mkShowHolding(d.holding);
    }
  });
  body.addEventListener("change", (e) => {
    const select = e.target as HTMLSelectElement;
    if (select.id === "mkHolding") {
      mkState.holding = select.value;
      mkState.years = null;
      $("mkHistory").innerHTML = mkHistoryHtml(marketSummary());
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
