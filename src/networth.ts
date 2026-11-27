import { CONFIG } from "./config";
import { simHtml, simOutputHtml, simOutputs, simState, type SimInput } from "./forecast";
import { excelDate, normalizeCurrency, parseAmount } from "./cellValues";
import { monthIndex, monthName, totalsByMonth } from "./insights";
import { getMarketData, marketSummary, mkFindHeader } from "./market";
import { moduleData } from "./modules";
import { activePage, shortMonth, showPage } from "./overview";
import { currencySymbol } from "./settings";
import { activeCurrency, setActiveCurrency } from "./state";
import type {
  AccountBalance,
  AccountEntry,
  AccountKind,
  AccountsData,
  MarketOrder,
  NetWorthGroup,
  NetWorthMonth,
  SheetMatrix,
} from "./types";
import { $, emptyCardHtml, esc, money, moneySign, roundCents, setMoneyCurrency, signedMoney, signedMoneyShort, todayIso } from "./utils";

/* =========================================================================
networth.ts
The Net worth page (#networthPage): what you own minus what you owe, at the
end of every month.

Reads two things:
  - the "Accounts" table of the finance workbook, found by its HEADINGS
    Date, Account, Balance (optional Type, Currency). One row per account
    each time its balance is noted, usually at the month end. A month
    without a row keeps the account's last balance.
    Type Loan / Card (credit card, mortgage, debt ...) is a debt: its
    balance is what is owed and is subtracted, whatever its sign.
  - the market file (market.ts), as one more asset. Its value at today's
    prices is used for the current month; earlier months use the amount
    invested at that month's end, because the file has no price history.

Income − expenses of each month (Income and Expense sheets, same currency)
shows how much of a month's change came from saving.
========================================================================= */

/* ------------ Reading the Accounts sheet ------------ */

let accountsData: AccountsData | null = null;
export function setAccountsData(value: AccountsData | null): void {
  accountsData = value;
}
export function hasAccountsData(): boolean {
  return accountsData !== null;
}

const DEBT_TYPE = /loan|card|credit|debt|liabilit|mortgage|overdraft|borrow|payable|emi/i;
const CASH_TYPE = /bank|cash|wallet|saving|current|deposit|^fd$|^rd$|fixed|recurring|liquid/i;

/** Asset or debt, from the Type column (or, without a type, the account name). */
export function accountKind(type: string, account = ""): AccountKind {
  return DEBT_TYPE.test(type || account) ? "debt" : "asset";
}

/** Chart group of an account. */
export function accountGroup(type: string, kind: AccountKind): NetWorthGroup {
  if (kind === "debt") return "debt";
  return CASH_TYPE.test(type) ? "cash" : "other";
}

const isoOf = (v: unknown): string | null => {
  const d = excelDate(v);
  return d ? d.toISOString().slice(0, 10) : null;
};

export function parseAccounts(sheets: SheetMatrix[]): AccountsData | null {
  const entries: AccountEntry[] = [];
  const sheetNames: string[] = [];
  let skipped = 0;
  for (const { name, grid } of sheets) {
    const h = mkFindHeader(grid, ["date", "account", "balance|closingbalance"]);
    if (!h) continue;
    sheetNames.push(name);
    const c = h.cols;
    const balCol = (c.balance ?? c.closingbalance)!;
    const txt = (row: (string | number)[], key: string) => (c[key] === undefined ? "" : String(row[c[key]!] ?? "").trim());
    for (let r = h.row + 1; r < grid.length; r++) {
      const row = grid[r];
      if (!row) continue;
      const account = txt(row, "account");
      const rawDate = row[c.date!];
      const date = isoOf(rawDate);
      const balance = parseAmount(row[balCol]);
      // Empty rows and year heading rows ("2026") are not entries
      if (!account && (date === null || /^\s*(19|20)\d{2}\s*$/.test(String(rawDate ?? "")))) continue;
      if (!account || !date || balance === null || !Number.isFinite(balance)) {
        skipped++;
        continue;
      }
      const type = txt(row, "type") || "Other";
      const kind = accountKind(c.type === undefined ? "" : type, account);
      entries.push({
        date,
        account,
        type,
        kind,
        balance: kind === "debt" ? Math.abs(balance) : balance,
        currency: normalizeCurrency(txt(row, "currency")) || CONFIG.currency,
      });
    }
  }
  if (!sheetNames.length) return null;
  // Oldest first; rows of the same date keep their sheet order (last one wins)
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { entries, skipped, sheetNames };
}

/* ------------ Working out net worth ------------ */

/** Amount still invested (average cost) after the orders up to `endIso`. */
export function marketCostAt(orders: MarketOrder[], endIso: string): number {
  const held = new Map<string, { qty: number; cost: number }>();
  for (const o of orders) {
    if (o.date > endIso) break; // orders are sorted by date
    const h = held.get(o.holding) || { qty: 0, cost: 0 };
    if (o.type === "Buy") {
      h.qty += o.units;
      h.cost += o.value;
    } else {
      const units = Math.min(o.units, h.qty);
      h.cost -= h.qty ? (h.cost / h.qty) * units : 0;
      h.qty -= units;
    }
    held.set(o.holding, h);
  }
  let total = 0;
  for (const h of held.values()) if (h.qty > 1e-9) total += h.cost;
  return total;
}

/** Last day of a month index, "YYYY-MM-DD". */
export function monthEnd(m: number): string {
  return new Date(Date.UTC(Math.floor(m / 12), (m % 12) + 1, 0)).toISOString().slice(0, 10);
}

export interface NetWorthInput {
  entries: AccountEntry[];
  /** Market file, only when it is in this currency */
  market?: { orders: MarketOrder[]; current: number } | null;
  /** Income − expenses per month index; null without both sheets */
  saved?: Map<number, number> | null;
  /** "YYYY-MM-DD" */
  today: string;
}

/** Net worth at the end of every month, first to last, gaps included. */
export function netWorthMonths({ entries, market, saved, today }: NetWorthInput): NetWorthMonth[] {
  const marketOn = !!market && market.orders.length > 0;
  const firsts: number[] = [];
  const lasts: number[] = [];
  if (entries.length) {
    firsts.push(monthIndex(entries[0]!.date));
    lasts.push(monthIndex(entries[entries.length - 1]!.date));
  }
  const nowM = monthIndex(today);
  if (marketOn) {
    firsts.push(monthIndex(market.orders[0]!.date));
    lasts.push(nowM);
  }
  if (!firsts.length) return [];
  const first = Math.min(...firsts);
  const last = Math.max(...lasts);

  // Accounts in the order they first appear
  const byAccount = new Map<string, AccountEntry[]>();
  for (const e of entries) {
    const list = byAccount.get(e.account) || [];
    list.push(e);
    byAccount.set(e.account, list);
  }

  const out: NetWorthMonth[] = [];
  for (let m = first; m <= last; m++) {
    const end = monthEnd(m);
    const accounts: AccountBalance[] = [];
    for (const [account, list] of byAccount) {
      let e: AccountEntry | undefined;
      for (const x of list) {
        if (x.date <= end) e = x;
        else break;
      }
      if (!e) continue;
      accounts.push({ account, type: e.type, kind: e.kind, group: accountGroup(e.type, e.kind), balance: e.balance, asOf: e.date });
    }
    let marketAtCost = false;
    if (marketOn && market.orders[0]!.date <= end) {
      const live = m >= nowM;
      marketAtCost = !live;
      const value = live ? market.current : marketCostAt(market.orders, end);
      accounts.push({ account: "Market holdings", type: "Market", kind: "asset", group: "market", balance: value, asOf: live ? today : end });
    }
    const sum = (g: NetWorthGroup) => roundCents(accounts.filter((a) => a.group === g).reduce((s, a) => s + a.balance, 0));
    const cash = sum("cash");
    const mkt = sum("market");
    const other = sum("other");
    const debt = sum("debt");
    const assets = roundCents(cash + mkt + other);
    out.push({
      m,
      cash,
      market: mkt,
      other,
      debt,
      assets,
      net: roundCents(assets - debt),
      saved: saved ? saved.get(m) || 0 : null,
      marketAtCost,
      accounts,
    });
  }
  return out;
}

/* ------------ Page state ------------ */

export const nwState: { month: number | null } = { month: null };

// Currencies the page can show: those of the accounts, plus the market's
function nwCurrencies(): string[] {
  const list = [...new Set((accountsData?.entries || []).map((e) => e.currency))];
  if (getMarketData() && !list.includes(CONFIG.currency)) list.push(CONFIG.currency);
  return list;
}

/** Everything the page shows, in the chosen currency. */
export function netWorthData(): NetWorthMonth[] {
  const entries = (accountsData?.entries || []).filter((e) => e.currency === activeCurrency);
  const md = getMarketData();
  const market = md && activeCurrency === CONFIG.currency ? { orders: md.orders, current: marketSummary().current } : null;
  const inc = (moduleData.income?.records || []).filter((r) => r.Currency === activeCurrency);
  const exp = (moduleData.expense?.records || []).filter((r) => r.Currency === activeCurrency);
  let saved: Map<number, number> | null = null;
  if (inc.length && exp.length) {
    const i = totalsByMonth(inc);
    const e = totalsByMonth(exp);
    saved = new Map();
    for (const m of new Set([...i.keys(), ...e.keys()])) saved.set(m, roundCents((i.get(m) || 0) - (e.get(m) || 0)));
  }
  return netWorthMonths({ entries, market, saved, today: todayIso() });
}

/* ------------ Drawing ------------ */

const GROUPS: { key: Exclude<NetWorthGroup, "debt">; name: string; color: string }[] = [
  { key: "cash", name: "Cash & bank", color: "#0f766e" },
  { key: "market", name: "Market", color: "#7c3aed" },
  { key: "other", name: "Other assets", color: "#5eead4" },
];
const DEBT_COLOR = "#be123c";

// Sign and colour follow the amount as shown, so "₹0" is never red
const signed = (v: number): string => signedMoney(v);
const signedShort = (v: number): string => signedMoneyShort(v, false);
const cls = (v: number): string => ["ov-neg", "", "ov-pos"][moneySign(v) + 1]!;
const dmy = (iso: string): string => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const pct = (v: number, of: number): string => (of > 0 ? `${Math.round((v / of) * 100)}%` : "–");

/* ---- What-if simulator (forecast.ts) ---- */

function simInput(months: NetWorthMonth[]): SimInput {
  const latest = months[months.length - 1];
  const md = getMarketData();
  const marketOn = !!md && activeCurrency === CONFIG.currency;
  return {
    income: (moduleData.income?.records || []).filter((r) => r.Currency === activeCurrency),
    expense: (moduleData.expense?.records || []).filter((r) => r.Currency === activeCurrency),
    orders: marketOn ? md.orders : [],
    start: latest ? { cash: latest.cash, invested: latest.market, other: latest.other, debt: latest.debt } : { cash: 0, invested: 0, other: 0, debt: 0 },
    hasStart: !!latest,
    xirr: marketOn ? marketSummary().xirr : null,
  };
}

let lastSimInput: SimInput | null = null;

function drawSimOutput(): void {
  if (!lastSimInput) return;
  const out = document.getElementById("nwSimOut");
  if (out) out.innerHTML = simOutputHtml(lastSimInput);
  const labels = simOutputs();
  for (const id of Object.keys(labels)) {
    const el = document.getElementById(`${id}Out`);
    if (el) el.textContent = labels[id]!;
  }
}

function simSectionHtml(months: NetWorthMonth[]): string {
  lastSimInput = simInput(months);
  return `<section class="card card-gap" id="nwSim">${simHtml(lastSimInput)}</section>`;
}

export function renderNetWorth(): void {
  if (activePage !== "networth") return;
  const body = $("nwBody");
  const months = netWorthData();
  if (!months.length) {
    $("nwSub").textContent = "What you own minus what you owe";
    body.innerHTML = emptyCardHtml(
      "Net worth",
      accountsData ? `No accounts in ${activeCurrency}` : "Add an Accounts sheet",
      'Add a sheet named "Accounts" to your workbook with the headings Date, Account, Type and Balance (Currency is optional), one row per account each time you note its balance. Type Loan or Card marks a debt. Your market file, if loaded, is added as an asset.',
    ) + simSectionHtml(months);
    drawSimOutput();
    return;
  }
  const at = (m: number) => months.find((x) => x.m === m);
  if (nwState.month === null || !at(nwState.month)) nwState.month = months[months.length - 1]!.m;
  const cur = at(nwState.month)!;
  const prev = at(cur.m - 1) || null;
  const nAccounts = cur.accounts.filter((a) => a.group !== "market").length;
  const sources = [accountsData?.sheetNames.length ? `"${accountsData.sheetNames.join('", "')}" sheet` : "", getMarketData() && activeCurrency === CONFIG.currency ? "market file" : ""]
    .filter(Boolean)
    .join(" + ");
  $("nwSub").textContent = `${sources} · ${monthName(months[0]!.m)} to ${monthName(months[months.length - 1]!.m)}${accountsData?.skipped ? ` · ${accountsData.skipped} rows skipped (date, account or balance missing)` : ""}`;

  /* ---- Cards ---- */
  const baseM = cur.m - (cur.m % 12) - 1; // December of the year before
  const base = at(baseM) || months[0]!;
  const ytd = cur.net - base.net;
  const cards = [
    {
      label: "Net worth",
      dot: "#0f766e",
      value: money(cur.net),
      sub: prev ? `${cur.net >= prev.net ? "▲" : "▼"} ${money(Math.abs(cur.net - prev.net))} vs ${monthName(prev.m)}` : `End of ${monthName(cur.m)}`,
      cls: cur.net < 0 ? "ov-neg" : "ov-pos",
    },
    { label: "Assets", dot: "#7c3aed", value: money(cur.assets), sub: `${nAccounts} account${nAccounts === 1 ? "" : "s"}${cur.market ? " + market" : ""}`, cls: "" },
    { label: "Debts", dot: DEBT_COLOR, value: money(cur.debt), sub: cur.assets > 0 ? `Debt-to-assets ${pct(cur.debt, cur.assets)}` : "Loans and card dues", cls: "" },
    {
      label: base.m === cur.m ? "Change" : `Change since ${monthName(base.m)}`,
      dot: "#0f766e",
      value: base.m === cur.m ? "–" : signed(ytd),
      sub: base.m === cur.m ? "First month of the data" : `${base.m === baseM ? "This year" : "Since the first month"}, to ${monthName(cur.m)}`,
      cls: base.m === cur.m ? "" : cls(ytd),
    },
  ];
  const cardsHtml = cards
    .map(
      (c) => `<div class="card ov-kpi"><span class="small ov-kpi-label"><span class="ov-dot" style="background:${c.dot}"></span>${esc(c.label)}</span><b class="${c.cls}">${esc(c.value)}</b><span class="small">${esc(c.sub)}</span></div>`,
    )
    .join("");

  /* ---- Monthly chart: last 24 months ---- */
  const shown = months.slice(-24);
  const topA = Math.max(1, ...shown.map((x) => GROUPS.reduce((s, g) => s + Math.max(0, x[g.key]), 0)));
  const topD = Math.max(1, ...shown.map((x) => x.debt));
  const anyDebt = shown.some((x) => x.debt > 0);
  const bars = shown
    .map((x) => {
      const on = x.m === cur.m;
      const h = (v: number, top: number) => `${((Math.max(0, v) / top) * 100).toFixed(1)}%`;
      const stack = [...GROUPS]
        .reverse()
        .map((g) => `<span class="nw-seg" style="height:${h(x[g.key], topA)};background:${g.color}"></span>`)
        .join("");
      const title = `${monthName(x.m)} · net worth ${money(x.net)} · assets ${money(x.assets)} · debts ${money(x.debt)}${x.marketAtCost ? " · market at cost" : ""}`;
      return `<button type="button" class="ov-month nw-month${on ? " on" : ""}" data-month="${x.m}" aria-pressed="${on}" title="${esc(title)}">
          <span class="ov-net ${cls(x.net)}">${esc(signedShort(x.net))}</span>
          <span class="nw-up">${stack}</span>
          ${anyDebt ? `<span class="nw-down"><span class="nw-seg" style="height:${h(x.debt, topD)};background:${DEBT_COLOR}"></span></span>` : ""}
          <span class="ov-mlabel">${esc(shortMonth(x.m))}</span>
        </button>`;
    })
    .join("");
  const legend = [...GROUPS.map((g) => [g.name, g.color]), ...(anyDebt ? [["Debts", DEBT_COLOR]] : [])]
    .map(([n, c]) => `<span><span class="ov-sw" style="background:${c}"></span>${esc(n!)}</span>`)
    .join("");
  const costNote = shown.some((x) => x.marketAtCost)
    ? '<div class="small nw-note">Market: value at today\'s prices for the current month; earlier months use the amount invested at that month\'s end, because the market file has no price history.</div>'
    : "";

  /* ---- What you own / owe ---- */
  const byType = (kind: AccountKind) => {
    const map = new Map<string, { v: number; color: string }>();
    for (const a of cur.accounts.filter((x) => x.kind === kind)) {
      const color = a.group === "debt" ? DEBT_COLOR : GROUPS.find((g) => g.key === a.group)!.color;
      const e = map.get(a.type) || { v: 0, color };
      e.v += a.balance;
      map.set(a.type, e);
    }
    return [...map.entries()].sort((a, b) => b[1].v - a[1].v);
  };
  const shareRows = (list: [string, { v: number; color: string }][], total: number) =>
    list
      .map(
        ([name, e]) => `<div class="nw-share"><div class="nw-share-row"><span class="nw-share-name">${esc(name)}</span><span class="small">${esc(pct(e.v, total))}</span><b>${esc(money(e.v))}</b></div>
          <span class="nw-track"><span style="width:${total > 0 ? Math.max(0, Math.min(100, (e.v / total) * 100)).toFixed(1) : 0}%;background:${e.color}"></span></span></div>`,
      )
      .join("");
  const owned = byType("asset");
  const owed = byType("debt");
  const ownHtml = `
      <div class="graphtitle"><b>What you own · ${esc(monthName(cur.m))}</b></div>
      <div class="small">Assets by type, share of all assets</div>
      <div class="nw-shares">${owned.length ? shareRows(owned, cur.assets) : '<div class="small">No assets.</div>'}</div>
      ${owed.length ? `<div class="graphtitle nw-sub"><b>What you owe</b></div><div class="nw-shares">${shareRows(owed, cur.debt)}</div>` : ""}`;

  /* ---- What changed since last month ---- */
  let changeHtml: string;
  if (!prev) {
    changeHtml = `<div class="graphtitle"><b>What changed</b></div><div class="small">${esc(monthName(cur.m))} is the first month of the data, so there is nothing to compare with.</div>`;
  } else {
    const diff = cur.net - prev.net;
    const rows = [
      ...GROUPS.map((g) => ({ name: g.name, v: cur[g.key] - prev[g.key] })),
      { name: "Debts", v: prev.debt - cur.debt },
    ].filter((r) => moneySign(r.v) !== 0);
    const savedHtml =
      cur.saved === null
        ? ""
        : `<div class="nw-bridge-split">
            <div class="nw-line"><span>Saved from income</span><span class="small">income − expenses</span><b class="${cls(cur.saved)}">${esc(signed(cur.saved))}</b></div>
            <div class="nw-line"><span>Market and other</span><span class="small">gains, interest, not logged</span><b class="${cls(diff - cur.saved)}">${esc(signed(diff - cur.saved))}</b></div>
          </div>`;
    changeHtml = `
      <div class="graphtitle"><b>What changed since ${esc(monthName(prev.m))}</b></div>
      <div class="small">Net worth change by part${cur.saved === null ? "" : ", and how much of it was saved"}</div>
      <div class="nw-bridge">
        <div class="nw-line"><span>Net worth ${esc(monthName(prev.m))}</span><span></span><b>${esc(money(prev.net))}</b></div>
        ${rows.map((r) => `<div class="nw-line"><span>${esc(r.name)}</span><span class="small">${r.name === "Debts" ? (r.v > 0 ? "paid down" : "more owed") : ""}</span><b class="${cls(r.v)}">${esc(signed(r.v))}</b></div>`).join("")}
        <div class="nw-line nw-total"><span>Net worth ${esc(monthName(cur.m))}</span><span></span><b class="${cls(cur.net)}">${esc(money(cur.net))}</b></div>
      </div>
      ${savedHtml}`;
  }

  /* ---- Accounts table ---- */
  const prevOf = new Map((prev?.accounts || []).map((a) => [a.account, a.balance]));
  const sorted = [...cur.accounts].sort((a, b) => (a.kind === b.kind ? b.balance - a.balance : a.kind === "asset" ? -1 : 1));
  const tableRows = sorted
    .map((a) => {
      const color = a.group === "debt" ? DEBT_COLOR : GROUPS.find((g) => g.key === a.group)!.color;
      const before = prevOf.get(a.account);
      let change = "–";
      let changeCls = "";
      if (before !== undefined) {
        const d = a.balance - before;
        const good = a.kind === "debt" ? -d : d;
        change = moneySign(d) === 0 ? "no change" : signed(d);
        changeCls = cls(good);
      } else if (prev) change = "new";
      const asOf = a.group !== "market" ? dmy(a.asOf) : cur.marketAtCost ? `at cost, ${dmy(a.asOf)}` : "today's prices";
      return `<tr><td><span class="ov-sw" style="background:${color}"></span>${esc(a.account)}</td><td class="num${a.kind === "debt" ? " nw-debt" : ""}">${esc(a.kind === "debt" ? `−${money(a.balance)}` : money(a.balance))}</td><td class="num ${changeCls}">${esc(change)}</td><td>${esc(a.type)}</td><td>${esc(asOf)}</td></tr>`;
    })
    .join("");

  body.innerHTML = `
    <section class="ov-kpis">${cardsHtml}</section>

    <section class="card card-gap" id="nwMonthly">
      <div class="ov-head">
        <div><div class="graphtitle"><b>Net worth by month</b></div><div class="small">Assets above the line${anyDebt ? ", debts below" : ""}, net worth on top. Click a month to look at it.</div></div>
        <div class="ov-key nw-key">${legend}</div>
      </div>
      <div class="ov-scroll"><div class="ov-months">${bars}</div></div>
      ${costNote}
    </section>

    <div class="ov-grid2 card-gap">
      <section class="card" id="nwOwn">${ownHtml}</section>
      <section class="card" id="nwChange">${changeHtml}</section>
    </div>

    <section class="card card-gap" id="nwAccounts">
      <div class="graphtitle"><b>Accounts · ${esc(monthName(cur.m))}</b></div>
      <div class="small">Latest balance of every account at the month end. A month without a row keeps the last balance.</div>
      <div class="mk-tablewrap"><table class="mk-table nw-table">
        <thead><tr><th>Account</th><th class="num">Balance</th><th class="num">vs last month</th><th>Type</th><th>As of</th></tr></thead>
        <tbody>${tableRows}</tbody>
        <tfoot><tr><td>Net worth</td><td class="num">${esc(money(cur.net))}</td><td class="num ${prev ? cls(cur.net - prev.net) : ""}">${prev ? esc(signed(cur.net - prev.net)) : "–"}</td><td></td><td></td></tr></tfoot>
      </table></div>
    </section>

    ${simSectionHtml(months)}`;
  drawSimOutput();
  // Newest months are at the right end of the chart: show them first
  const scroller = body.querySelector<HTMLElement>("#nwMonthly .ov-scroll");
  if (scroller) scroller.scrollLeft = scroller.scrollWidth;
}

/* ------------ Page switching ------------ */

// Side bar badge: number of accounts
export function updateNetWorthCount(): void {
  const el = document.querySelector("[data-count='networth']");
  if (el) el.textContent = accountsData ? String(new Set(accountsData.entries.map((e) => e.account)).size) : "";
}

function setupNetWorthCurrency(): void {
  const options = nwCurrencies();
  const first = options.includes(activeCurrency) ? activeCurrency : options[0] || CONFIG.currency;
  $("currency").innerHTML = options
    .map(
      (code) =>
        `<label class="cur-opt" title="${esc(code)}"><input type="radio" name="currency" value="${esc(code)}"${code === first ? " checked" : ""} aria-label="${esc(code)}"><span aria-hidden="true">${esc(currencySymbol(code))}</span></label>`,
    )
    .join("");
  $("currency").hidden = options.length < 2;
  setActiveCurrency(first);
  setMoneyCurrency(first);
}

export function selectNetWorth(): void {
  showPage("networth");
  setupNetWorthCurrency();
  renderNetWorth();
}

export function setupNetWorth(): void {
  document.querySelectorAll<HTMLElement>(".side-item[data-page='networth']").forEach((b) => {
    b.onclick = () => {
      if (activePage === "networth") return;
      selectNetWorth();
      window.scrollTo({ top: 0 });
    };
  });
  const body = $("nwBody");
  body.addEventListener("click", (e) => {
    const t = e.target as Element;
    const month = t.closest<HTMLElement>(".nw-month");
    if (month) {
      nwState.month = Number(month.dataset.month);
      renderNetWorth();
      return;
    }
    const b = t.closest<HTMLElement>("#nwSim button");
    if (!b) return;
    const d = b.dataset;
    if (d.years) {
      simState.years = Number(d.years);
      body.querySelectorAll<HTMLElement>("#simPeriod button").forEach((x) => {
        const on = x === b;
        x.classList.toggle("on", on);
        x.setAttribute("aria-pressed", String(on));
      });
    } else if (d.view) {
      simState.view = d.view as "net" | "saved";
    } else if (d.cat !== undefined && simState.discretionary) {
      const on = !simState.discretionary.has(d.cat);
      if (on) simState.discretionary.add(d.cat);
      else simState.discretionary.delete(d.cat);
      b.setAttribute("aria-pressed", String(on));
      // The cut slider's hint names the discretionary amount: redraw the block
      renderSim();
      return;
    } else return;
    drawSimOutput();
  });
  // Sliders: only the results are redrawn, so the slider keeps focus while dragged
  body.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    const v = Number(el.value);
    if (el.id === "simCut") simState.cut = v;
    else if (el.id === "simExtra") simState.extra = v;
    else if (el.id === "simRet") simState.ret = v;
    else if (el.id === "simGrowth") simState.growth = v;
    else return;
    drawSimOutput();
  });
}

// Redraw only the simulator block (keeps the chart scroll and the rest)
function renderSim(): void {
  const box = document.getElementById("nwSim");
  if (!box || !lastSimInput) return;
  box.innerHTML = simHtml(lastSimInput);
  drawSimOutput();
}
