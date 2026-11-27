import { CONFIG } from "./config";
import { MODULES } from "./modules";
import { emptySettings } from "./state";
import type {
  CellValue,
  ModuleDefinition,
  ModuleParseResult,
  Settings,
  SettingsListKey,
  SheetGrid,
  SheetMatrix,
  SkippedRows,
  Transaction,
} from "./types";

/* ========================================================
   excel.ts
   Reads an .xlsx file in the browser with no libraries.

   An .xlsx file is a ZIP of XML files. The steps are:
     1. unzipXlsx() ......-> pull the needed XML files out of the ZIP
     2. workbookMatrices() -> turn each sheet's XML into a grid of cells
     3. parseMatrices() ....-> read the Settings sheet, find the expense
                              tables and make records

   Expense tables (any sheet except "Settings"):
     - A header row within the first 5 rows. It must have Date, Amount,
       Category and Mode; Particulars, Currency and Credit are optional,
       and other columns (e.g. Investment) are never read. Column order
       does not matter. Several tables may sit side by side.
     - The row above it holds a year heading over each table (e.g. "2026").
       Without one, each record's own date year is used.
     - Dates may be real Excel dates or text such as 17-10-2026
       (dd-mm-yyyy; dd/mm/yyyy and yyyy-mm-dd also work).
     - A row's amount is Amount + Credit (either may be empty). A row with
       both empty is skipped silently; a row whose date or amount cannot be
       read is skipped and counted.

   "Settings" sheet: headings in one of the first 5 rows, each with a list
   under it: Currency (first one = default; rows in any other currency are
   not read), Ignore Columns, Ignore Date, Ignore Particulars, Ignore
   Category, Ignore Mode (rows matching an entry exactly are not read).
   ======================================================== */

// Read 16- / 32-bit little-endian numbers from a DataView
function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}
function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

// Only these files are needed; everything else in the ZIP is skipped
function isNeededXlsxFile(name: string): boolean {
  return (
    name === "xl/sharedStrings.xml" ||
    name === "xl/workbook.xml" ||
    name === "xl/_rels/workbook.xml.rels" ||
    /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
  );
}

/* -------- Step 1: unzip -------- */

// Returns { "path/in/zip.xml": Uint8Array, ... } for the needed files
async function unzipXlsx(buf: ArrayBuffer): Promise<Record<string, Uint8Array>> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const decoder = new TextDecoder();

  // Find the "end of central directory" record at the end of the file
  let eocd = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 65557);
    i--
  ) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw Error("Invalid XLSX ZIP");

  const count = u16(view, eocd + 10); // number of files in the ZIP
  let pos = u32(view, eocd + 16); // where the file list starts
  const files: Record<string, Uint8Array> = {};

  for (let n = 0; n < count; n++) {
    if (u32(view, pos) !== 0x02014b50) throw Error("Invalid ZIP directory");

    const method = u16(view, pos + 10); // 0 = stored, 8 = deflate
    const size = u32(view, pos + 20);
    const nameLen = u16(view, pos + 28);
    const extraLen = u16(view, pos + 30);
    const commentLen = u16(view, pos + 32);
    const localOffset = u32(view, pos + 42);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;

    if (!isNeededXlsxFile(name)) continue;

    // The file data sits after its own local header
    const localNameLen = u16(view, localOffset + 26);
    const localExtraLen = u16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    let raw = bytes.subarray(dataStart, dataStart + size);

    if (method === 8) {
      // Compressed: let the browser inflate it
      const stream = new Blob([raw as Uint8Array<ArrayBuffer>])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      raw = new Uint8Array(await new Response(stream).arrayBuffer());
    } else if (method !== 0) {
      throw Error("Unsupported ZIP compression");
    }

    files[name] = raw;
  }
  return files;
}

/* -------- Step 2: sheet XML -> grid of cells -------- */

// Strip XML tags and decode XML entities (named and numeric) in ONE pass,
// so "&amp;lt;" correctly becomes the text "&lt;" and not "<"
function xmlText(s: string): string {
  // Fast path: most values (numbers, plain words) contain no tags or entities
  if (!s.includes("<") && !s.includes("&")) return s;
  const named: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (all: string, code: string) => {
      if (code[0] !== "#") return named[code.toLowerCase()]!;
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      try {
        return String.fromCodePoint(n);
      } catch {
        return all; // not a real character: leave it as it is
      }
    });
}

// Column letters -> number: "A" -> 0, "B" -> 1, "AA" -> 26
function colIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + letters.charCodeAt(i) - 64;
  }
  return n - 1;
}

// Value of one attribute in the text of an XML tag: xmlAttr('a="1" b="2"', "b") -> "2"
function xmlAttr(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? xmlText(m[1]) : "";
}

// The sheets in tab order, with their names: [{ name, file }]
function sheetList(
  zip: Record<string, Uint8Array>,
  decoder: TextDecoder,
): { name: string; file: string }[] {
  const files = Object.keys(zip)
    .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const read = (path: string) => (zip[path] ? decoder.decode(zip[path]) : "");

  // workbook.xml names the sheets; its .rels file says which file is which
  const targets = new Map<string, string>();
  for (const m of read("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b([^>]*)>/g)) {
    targets.set(xmlAttr(m[1], "Id"), xmlAttr(m[1], "Target"));
  }
  const list: { name: string; file: string }[] = [];
  for (const m of read("xl/workbook.xml").matchAll(/<sheet\b([^>]*)>/g)) {
    const target = targets.get(xmlAttr(m[1], "r:id"));
    if (!target) continue;
    const file = target.startsWith("/") ? target.slice(1) : "xl/" + target;
    if (files.includes(file)) list.push({ name: xmlAttr(m[1], "name"), file });
  }
  // No usable workbook.xml: file order, generic names
  return list.length ? list : files.map((file, i) => ({ name: `Sheet${i + 1}`, file }));
}

// Returns one entry per sheet: { name, grid }, grid[rowIndex][columnIndex] = cell value
export async function workbookMatrices(buf: ArrayBuffer): Promise<SheetMatrix[]> {
  const zip = await unzipXlsx(buf);
  const decoder = new TextDecoder();

  // Text cells point into a shared list of strings. Phonetic (furigana)
  // text is not part of the cell's text, so it is left out.
  let sharedStrings: string[] = [];
  if (zip["xl/sharedStrings.xml"]) {
    const xml = decoder.decode(zip["xl/sharedStrings.xml"]);
    sharedStrings = [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
      [...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((t) => xmlText(t[1]))
        .join(""),
    );
  }

  const sheets: SheetMatrix[] = [];
  for (const { name, file } of sheetList(zip, decoder)) {
    const xml = decoder.decode(zip[file]!);
    const grid: SheetGrid = [];

    // Every <c...>...</c> (or self-closing <c.../>) is one cell
    const cellPattern = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    for (const m of xml.matchAll(cellPattern)) {
      const attrs = m[1] || m[2] || "";
      const body = m[3] || "";

      // Cell reference such as r="AB12": letters = column, digits = row
      const refMatch = attrs.match(/\br="([A-Z]+)(\d+)"/);
      if (!refMatch) continue;

      const rowIdx = Number(refMatch[2]) - 1;
      const colIdx = colIndex(refMatch[1]);
      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : "n";

      const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
      let value: CellValue = valueMatch ? xmlText(valueMatch[1]) : "";

      if (type === "s") value = sharedStrings[Number(value)] ?? "";
      else if (type === "inlineStr") value = xmlText(body);
      else if (value !== "" && !isNaN(Number(value))) value = Number(value);

      (grid[rowIdx] ??= [])[colIdx] = value;
    }
    sheets.push({ name, grid });
  }
  return sheets;
}

/* -------- Step 3: grid -> records -------- */

// How many top rows are searched for the Date | Particular | ... header
const HEADER_SEARCH_ROWS = 5;

// Text dates: dd-mm-yyyy (also dd/mm/yyyy, dd.mm.yyyy) and yyyy-mm-dd, with
// an optional time after them. Built with Date.UTC, so the day never shifts
// with the time zone. Returns null for impossible dates (31-02-2025).
function parseTextDate(text: unknown): Date | null {
  const s = String(text).trim();
  let y: number, m: number, d: number;
  let parts: RegExpMatchArray | null;
  if ((parts = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:[ T].*)?$/))) {
    d = Number(parts[1]);
    m = Number(parts[2]);
    y = Number(parts[3]);
  } else if ((parts = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T].*)?$/))) {
    y = Number(parts[1]);
    m = Number(parts[2]);
    d = Number(parts[3]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  const real =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d;
  return real ? date : null;
}

// A cell -> a UTC Date, or null. Excel stores dates as day numbers; text
// dates go through parseTextDate().
export function excelDate(v: unknown): Date | null {
  if (typeof v === "number") {
    return v > 0
      ? new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000))
      : null;
  }
  const s = String(v ?? "").trim();
  if (!s) return null;
  const parsed = parseTextDate(s);
  if (parsed) return parsed;
  // Month written as a word ("14 Mar 2025"): keep the calendar day as typed
  if (/[a-z]{3}/i.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  return null;
}

// A cell -> a number, null when it is empty, NaN when it is not a number.
// Numbers are used as they are; text like "1,234 INR" is cleaned first.
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const cleaned = text.replace(/,/g, "").replace(/[^0-9.-]/g, "");
  return cleaned === "" ? NaN : Number(cleaned);
}

/* ------------ Column headings and currencies ------------ */

// Heading (letters only, lower case) -> the column it stands for
const COLUMN_ALIASES: Record<string, string> = {
  date: "date",
  particular: "particular",
  particulars: "particular",
  amount: "amount",
  currency: "currency",
  credit: "credit",
  // Income sheet: principal returned with a receipt (e.g. a matured FD).
  // Read and shown, but NOT added to the amount.
  principle: "principal",
  principal: "principal",
  category: "category",
  mode: "mode",
  modeofpayment: "mode",
  paymentmode: "mode",
};

// "Particulars " -> "particular". Unknown headings keep their own name.
function columnKey(heading: unknown): string {
  const letters = String(heading ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return COLUMN_ALIASES[letters] || letters;
}

// "¥" -> "JPY", "inr" -> "INR", "" -> ""
function normalizeCurrency(raw: unknown): string {
  const text = String(raw ?? "").trim();
  return text ? CONFIG.currencySymbols[text] || text.toUpperCase() : "";
}

// Does the cell hold a real value (not empty, not only spaces)?
const hasValue = (v: unknown): boolean => v !== undefined && v !== null && String(v).trim() !== "";

/* ------------ Settings sheet ------------ */

// Heading of a list on the Settings sheet -> its name in `settings`
const SETTINGS_HEADINGS: [RegExp, SettingsListKey][] = [
  [/^currenc/, "currencies"],
  [/^ignorecolumn/, "ignoreColumns"],
  [/^ignoredate/, "ignoreDates"],
  [/^ignoreparticular/, "ignoreParticulars"],
  [/^ignorecategor/, "ignoreCategories"],
  [/^ignoremode/, "ignoreModes"],
];

// Headings sit in one of the first rows; each list runs down its column
function parseSettings(grid: SheetGrid): Settings {
  const settings = emptySettings();
  for (let hr = 0; hr < Math.min(HEADER_SEARCH_ROWS, grid.length); hr++) {
    const headerRow = grid[hr] || [];
    for (let c = 0; c < headerRow.length; c++) {
      const heading = String(headerRow[c] ?? "").toLowerCase().replace(/[^a-z]/g, "");
      const hit = SETTINGS_HEADINGS.find(([pattern]) => pattern.test(heading));
      if (!hit) continue;
      settings.found = true;

      for (let r = hr + 1; r < grid.length; r++) {
        const value = grid[r]?.[c];
        if (!hasValue(value)) continue;
        const list = settings[hit[1]];
        if (hit[1] === "currencies") {
          const code = normalizeCurrency(value);
          if (!list.includes(code)) list.push(code);
        } else if (hit[1] === "ignoreDates") {
          const date = excelDate(value);
          if (date) list.push(date.toISOString().slice(0, 10));
        } else {
          list.push(String(value).trim());
        }
      }
    }
    if (settings.found) break;
  }
  return settings;
}

/* ------------ Expense tables ------------ */

// Find every expense table and read its rows.
// sheets = [{ name, grid }]. Returns { records, skipped, settings }:
// skipped = { count, samples } counts the rows that have an amount but no
// readable date, or an amount that is not a number.
// module = one entry of MODULES (modules.ts): which sheet holds its table
// and which sheet its settings.
export function parseMatrices(sheets: SheetMatrix[], module: ModuleDefinition): ModuleParseResult {
  const records: Transaction[] = [];
  const skipped: SkippedRows = { count: 0, samples: [] };

  // "Expense Settings", "expense_settings" -> "expense_settings"
  const norm = (name: string) => String(name).trim().toLowerCase().replace(/[\s_-]+/g, "_");
  let settingsSheet: SheetMatrix | undefined;
  for (const wanted of module.settingsSheets) {
    settingsSheet = sheets.find((s) => norm(s.name) === wanted);
    if (settingsSheet) break;
  }
  const settings = settingsSheet ? parseSettings(settingsSheet.grid) : emptySettings();

  // The module's own sheet ("Expense", "Income"). An older workbook with no
  // module sheets at all is read the old way (every sheet = expense tables).
  const moduleNames = new Set(Object.values(MODULES).map((m) => m.sheet));
  const own = sheets.filter((s) => norm(s.name) === module.sheet);
  const hasModuleSheets = sheets.some((s) => moduleNames.has(norm(s.name)));
  const dataSheets = own.length
    ? own
    : module.legacy && !hasModuleSheets
      ? sheets.filter((s) => !/settings$/.test(norm(s.name)))
      : [];

  // What not to read (exact matches, upper/lower case ignored)
  const lower = (list: string[]) => new Set(list.map((v) => v.toLowerCase()));
  const ignore = {
    columns: new Set(settings.ignoreColumns.map(columnKey)),
    dates: new Set(settings.ignoreDates),
    particulars: lower(settings.ignoreParticulars),
    categories: lower(settings.ignoreCategories),
    modes: lower(settings.ignoreModes),
  };
  const allowedCurrencies = new Set(settings.currencies);
  const defaultCurrency = settings.currencies[0] || CONFIG.currency;

  dataSheets.forEach((sheet) => {
    const grid = sheet.grid;

    // The first of the top rows that holds a table header is THE header row
    for (let hr = 0; hr < Math.min(HEADER_SEARCH_ROWS, grid.length); hr++) {
      const headerRow = grid[hr] || [];
      let found = false;

      for (let c = 0; c < headerRow.length; c++) {
        if (!hasValue(headerRow[c])) continue;

        // A table is the run of headings up to an empty cell, or up to a
        // second "Date" (which starts the next table)
        const cols: Record<string, number> = Object.create(null); // column key -> column number
        const start = c;
        let j = c;
        for (; j < headerRow.length && hasValue(headerRow[j]); j++) {
          const key = columnKey(headerRow[j]);
          if (key === "date" && "date" in cols) break;
          if (!(key in cols)) cols[key] = j;
        }
        c = j - 1;
        if (!["date", "amount", "category", "mode"].every((k) => k in cols)) continue;
        found = true;

        // Columns the Settings sheet says not to read (Date and Amount are
        // needed for any record, so they cannot be left out)
        ignore.columns.forEach((k) => {
          if (k !== "date" && k !== "amount") delete cols[k];
        });
        const cell = (cells: CellValue[], key: string): CellValue | undefined => (key in cols ? cells[cols[key]] : undefined);

        // Year heading in the row above the header (4 digits starting 19 or 20)
        // (over the first column of the table, or else over its Date column)
        const above = hr > 0 ? grid[hr - 1] || [] : [];
        const heading = hasValue(above[start]) ? above[start] : above[cols.date];
        const yearMatch = String(heading ?? "").match(/(?:19|20)\d{2}/);

        for (let r = hr + 1; r < grid.length; r++) {
          const cells = grid[r] || [];
          // Completely empty row (or end of a shorter table): nothing to read
          if (!Object.values(cols).some((col) => hasValue(cells[col]))) continue;

          const particular = String(cell(cells, "particular") ?? "").trim();
          const category = String(cell(cells, "category") ?? "").trim() || "Uncategorized";
          const mode = String(cell(cells, "mode") ?? "").trim() || "Unknown";
          let currency =
            "currency" in cols ? normalizeCurrency(cell(cells, "currency")) : defaultCurrency;
          if (!currency && !allowedCurrencies.size) currency = defaultCurrency;

          // Not read at all, according to the Settings sheet
          if (allowedCurrencies.size && !allowedCurrencies.has(currency)) continue;
          if (ignore.categories.has(category.toLowerCase())) continue;
          if (ignore.modes.has(mode.toLowerCase())) continue;
          if (ignore.particulars.has(particular.toLowerCase())) continue;

          // Amount + Credit: one of them may be empty, both empty = no spending
          const amount = parseAmount(cell(cells, "amount"));
          const credit = parseAmount(cell(cells, "credit"));
          if (amount === null && credit === null) continue;

          const date = excelDate(cell(cells, "date"));
          if (!date || Number.isNaN(amount) || Number.isNaN(credit)) {
            skipped.count++;
            if (skipped.samples.length < 5) {
              skipped.samples.push(`sheet "${sheet.name}", row ${r + 1}`);
            }
            continue;
          }

          // Use the year heading if present, otherwise the date's own year
          const year = yearMatch ? yearMatch[0] : String(date.getUTCFullYear());
          const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
          const dd = String(date.getUTCDate()).padStart(2, "0");
          const iso = `${date.getUTCFullYear()}-${mm}-${dd}`;
          if (ignore.dates.has(iso)) continue;

          const principal = parseAmount(cell(cells, "principal"));
          const record: Transaction = {
            Date: iso,
            Particular: particular,
            Amount: (amount || 0) + (credit || 0),
            Principal: principal !== null && Number.isFinite(principal) ? principal : null,
            Category: category,
            Mode: mode,
            Currency: currency,
            Year: year,
            // Worked out once here so filtering never has to re-parse dates
            Month: CONFIG.months[date.getUTCMonth()],
            Search: "",
          };
          record.Search = [
            record.Date,
            record.Particular,
            record.Amount,
            record.Category,
            record.Mode,
            record.Currency,
            record.Year,
            record.Principal ?? "",
          ]
            .join(" ")
            .toLowerCase();
          records.push(record);
        }
      }

      if (found) break;
    }
  });

  return {
    records,
    skipped,
    settings,
    settingsSheetName: settingsSheet ? settingsSheet.name : "",
    sheetNames: dataSheets.map((s) => s.name),
  };
}
