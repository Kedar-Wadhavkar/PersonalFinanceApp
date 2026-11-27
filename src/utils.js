/* =========================================================================
utils.js
Small helpers used everywhere. No dependency on page content.
========================================================================= */

// Shortcut for document.getElementById
const $ = (id) => document.getElementById(id);

// The formatters are rebuilt only when the currency changes (building one is
// slow, formatting is fast). setMoneyCurrency() is called when a workbook is
// loaded and when the currency selector changes.
let moneyFormat;
let moneyShortFormat;

function makeMoneyFormat(code, compact) {
  const locale = CONFIG.currencyLocales[code] || CONFIG.currencyLocaleDefault;
  const options = compact
    ? { notation: "compact", maximumFractionDigits: 1 }
    : { maximumFractionDigits: 0 };
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      ...options,
    });
  } catch {
    return new Intl.NumberFormat(locale, options); // unknown code: plain number
  }
}

function setMoneyCurrency(code) {
  moneyFormat = makeMoneyFormat(code, false);
  moneyShortFormat = makeMoneyFormat(code, true);
}
setMoneyCurrency(CONFIG.currency);

// Format a number as currency, e.g. 1234 -> "₹1,234" (the selected currency)
const money = (n) => moneyFormat.format(n || 0);

// Short form for small spaces, e.g. 1698859 -> "₹17L" (INR) or "¥1.7M"
const moneyShort = (n) => moneyShortFormat.format(n || 0);

// Run fn only after the caller has stopped calling for `wait` ms
const debounce = (fn, wait = 120) => {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
};

// Make text safe to put inside innerHTML (stops HTML injection from cells)
function esc(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Placeholder shown by lists and charts when nothing is selected
const NO_DATA_HTML = '<div class="small nodata">No data selected</div>';

// Open or close one menu (a filter dropdown .multi or a sort menu
// .sortwrap). Its button tells screen readers whether it is open.
function setMenuOpen(box, open) {
  box.classList.toggle("open", open);
  const button = box.querySelector(":scope > button");
  if (button) button.setAttribute("aria-expanded", String(open));
}

// Close every open menu (a click elsewhere, or the Esc key)
function closeMenus(except = null) {
  document.querySelectorAll(".sortwrap.open, .multi.open").forEach((box) => {
    if (box !== except) setMenuOpen(box, false);
  });
}

// Open/close behaviour of dropdown buttons
function wireMultiToggles(containerIds) {
  containerIds.forEach((id) => {
    const box = $(id);
    const button = box.querySelector(":scope > button");
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");
    button.onclick = () => setMenuOpen(box, !box.classList.contains("open"));
  });
}

// Mix a "#rrggbb" colour with white: amount 0 = unchanged, 1 = white.
// Used for the light version of a colour (dimmed lines, curve over the bars).
function tint(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

// SVG path of a smooth curve through the points [[x, y], ...] (x ascending).
// tension: how far the curve bends (1/3 = full curve, 0 = straight segments).
// A monotone cubic curve: it never swings above or below the points it joins,
// so the curve over a row of bars does not dip under the zero line.
function smoothPath(pts, tension = 1 / 3) {
  const n = pts.length;
  if (n < 2) return "";
  const f = (v) => v.toFixed(1);
  const move = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  if (n === 2) return `${move} L${f(pts[1][0])} ${f(pts[1][1])}`;

  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    slope[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0;
  }
  // Slope at every point: the average of its two sides, 0 at a turning point
  const t = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    t[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  t[n - 1] = slope[n - 2];
  // Keep every piece monotone (Fritsch-Carlson)
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      t[i] = t[i + 1] = 0;
      continue;
    }
    const a = t[i] / slope[i];
    const b = t[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * slope[i];
      t[i + 1] = k * b * slope[i];
    }
  }

  let d = move;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] * tension;
    d += ` C${f(pts[i][0] + h)} ${f(pts[i][1] + t[i] * h)} ${f(pts[i + 1][0] - h)} ${f(pts[i + 1][1] - t[i + 1] * h)} ${f(pts[i + 1][0])} ${f(pts[i + 1][1])}`;
  }
  return d;
}
