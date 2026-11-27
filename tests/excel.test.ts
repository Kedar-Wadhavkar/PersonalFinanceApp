import { describe, expect, it } from "vitest";
import {
  colIndex,
  columnKey,
  excelDate,
  hasValue,
  normalizeCurrency,
  parseAmount,
  parseMatrices,
  parseSettings,
  parseTextDate,
  unzipXlsx,
  workbookMatrices,
  xmlAttr,
  xmlText,
} from "../src/excel";
import { MODULES } from "../src/modules";
import type { SheetMatrix } from "../src/types";
import { buildXlsx, serial, zip } from "./helpers/xlsx";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/* =================================================================
   Cell values
   ================================================================= */

describe("parseAmount", () => {
  it("uses numbers as they are", () => {
    expect(parseAmount(1234.5)).toBe(1234.5);
    expect(parseAmount(0)).toBe(0);
    expect(parseAmount(-20)).toBe(-20);
  });

  it("treats empty cells as no value", () => {
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
  });

  it("reads text numbers with grouping and currency marks", () => {
    expect(parseAmount("1,234")).toBe(1234);
    expect(parseAmount("12,34,567.50")).toBe(1234567.5);
    expect(parseAmount("₹ 1,200")).toBe(1200);
    expect(parseAmount("$99.99")).toBe(99.99);
    expect(parseAmount("1,500 INR")).toBe(1500);
    expect(parseAmount(" 42 ")).toBe(42);
    expect(parseAmount("-75")).toBe(-75);
  });

  it('reads "Rs." amounts without taking the dot as a decimal point', () => {
    expect(parseAmount("Rs.500")).toBe(500);
    expect(parseAmount("Rs. 500")).toBe(500);
    expect(parseAmount("Rs.1,250.75")).toBe(1250.75);
    expect(parseAmount("INR.300")).toBe(300);
  });

  it('reads the Indian "/-" ending', () => {
    expect(parseAmount("1200/-")).toBe(1200);
    expect(parseAmount("Rs. 1,200/-")).toBe(1200);
  });

  it("reads accounting negatives and the minus sign character", () => {
    expect(parseAmount("(1,234)")).toBe(-1234);
    expect(parseAmount("(₹500.25)")).toBe(-500.25);
    expect(parseAmount("−300")).toBe(-300); // U+2212
    expect(parseAmount("-₹45")).toBe(-45);
    expect(parseAmount("₹-45")).toBe(-45);
  });

  it("flags text that is not an amount (NaN) instead of guessing", () => {
    expect(parseAmount("N/A")).toBeNaN();
    expect(parseAmount("-")).toBeNaN();
    expect(parseAmount("abc")).toBeNaN();
    expect(parseAmount("12-500")).toBeNaN();
    expect(parseAmount("1.2.3")).toBeNaN();
    expect(parseAmount("12 apples")).toBeNaN();
    expect(parseAmount("5k")).toBeNaN();
  });
});

describe("parseTextDate", () => {
  it("reads dd-mm-yyyy with any separator", () => {
    expect(iso(parseTextDate("14-03-2025"))).toBe("2025-03-14");
    expect(iso(parseTextDate("14/03/2025"))).toBe("2025-03-14");
    expect(iso(parseTextDate("4.3.2025"))).toBe("2025-03-04");
  });

  it("reads yyyy-mm-dd and ignores a time after the date", () => {
    expect(iso(parseTextDate("2025-03-14"))).toBe("2025-03-14");
    expect(iso(parseTextDate("2025/3/4"))).toBe("2025-03-04");
    expect(iso(parseTextDate("2025-03-14T18:30:00"))).toBe("2025-03-14");
    expect(iso(parseTextDate("14-03-2025 23:59"))).toBe("2025-03-14");
  });

  it("rejects impossible dates", () => {
    expect(parseTextDate("31-02-2025")).toBeNull();
    expect(parseTextDate("29-02-2025")).toBeNull();
    expect(iso(parseTextDate("29-02-2024"))).toBe("2024-02-29");
    expect(parseTextDate("00-01-2025")).toBeNull();
    expect(parseTextDate("12-13-2025")).toBeNull();
    expect(parseTextDate("hello")).toBeNull();
  });

  it("reads month names (14-Mar-2025, 14 March 25)", () => {
    expect(iso(parseTextDate("14-Mar-2025"))).toBe("2025-03-14");
    expect(iso(parseTextDate("14-Mar-25"))).toBe("2025-03-14");
    expect(iso(parseTextDate("1 September 2024"))).toBe("2024-09-01");
    expect(iso(parseTextDate("31-Apr-2025"))).toBeNull();
  });
});

describe("excelDate", () => {
  it("turns Excel day numbers into UTC dates", () => {
    expect(iso(excelDate(45730))).toBe("2025-03-14");
    expect(iso(excelDate(serial("2026-01-01")))).toBe("2026-01-01");
    // A date with a time of day stays on its own day
    expect(iso(excelDate(45730.75))).toBe("2025-03-14");
    expect(iso(excelDate(45730.9999))).toBe("2025-03-14");
  });

  it("rejects zero, negative numbers and empty cells", () => {
    expect(excelDate(0)).toBeNull();
    expect(excelDate(-5)).toBeNull();
    expect(excelDate("")).toBeNull();
    expect(excelDate(undefined)).toBeNull();
  });

  it("reads text dates and English month names", () => {
    expect(iso(excelDate("14-03-2025"))).toBe("2025-03-14");
    expect(iso(excelDate("14 Mar 2025"))).toBe("2025-03-14");
    expect(iso(excelDate("Mar 14, 2025"))).toBe("2025-03-14");
    expect(excelDate("not a date")).toBeNull();
  });
});

describe("column headings and currencies", () => {
  it("maps headings to columns, ignoring case, spaces and marks", () => {
    expect(columnKey("Date")).toBe("date");
    expect(columnKey("Particulars ")).toBe("particular");
    expect(columnKey("Mode of Payment")).toBe("mode");
    expect(columnKey("Payment-Mode")).toBe("mode");
    expect(columnKey("Principle")).toBe("principal");
    expect(columnKey("Investment")).toBe("investment");
    expect(columnKey(undefined)).toBe("");
  });

  it("normalizes currency symbols and codes", () => {
    expect(normalizeCurrency("₹")).toBe("INR");
    expect(normalizeCurrency("Rs.")).toBe("INR");
    expect(normalizeCurrency(" ¥ ")).toBe("JPY");
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency("")).toBe("");
    expect(normalizeCurrency(undefined)).toBe("");
  });

  it("knows which cells hold a value", () => {
    expect(hasValue(0)).toBe(true);
    expect(hasValue("x")).toBe(true);
    expect(hasValue("  ")).toBe(false);
    expect(hasValue(undefined)).toBe(false);
    expect(hasValue(null)).toBe(false);
  });
});

/* =================================================================
   XML and ZIP
   ================================================================= */

describe("XML helpers", () => {
  it("decodes entities in one pass", () => {
    expect(xmlText("Food &amp; Drinks")).toBe("Food & Drinks");
    expect(xmlText("&amp;lt;")).toBe("&lt;");
    expect(xmlText("&#8377;&#x20B9;")).toBe("₹₹");
    expect(xmlText("<b>bold</b> text")).toBe("bold text");
    expect(xmlText("&#xFFFFFFF;")).toBe("&#xFFFFFFF;");
  });

  it("reads column letters and attributes", () => {
    expect(colIndex("A")).toBe(0);
    expect(colIndex("Z")).toBe(25);
    expect(colIndex("AA")).toBe(26);
    expect(colIndex("XFD")).toBe(16383);
    expect(xmlAttr(' name="Expense" r:id="rId2"', "r:id")).toBe("rId2");
    expect(xmlAttr(' name="A &amp; B"', "name")).toBe("A & B");
    expect(xmlAttr(' name="x"', "missing")).toBe("");
  });

  it("unzips stored and deflated parts and skips files it does not need", async () => {
    for (const compress of [true, false]) {
      const buf = await zip(
        [
          ["xl/workbook.xml", "<workbook/>"],
          ["xl/styles.xml", "<styleSheet/>"],
          ["xl/worksheets/sheet1.xml", "<worksheet>é</worksheet>"],
        ],
        compress,
      );
      const files = await unzipXlsx(buf);
      expect(Object.keys(files).sort()).toEqual(["xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
      expect(new TextDecoder().decode(files["xl/worksheets/sheet1.xml"])).toBe("<worksheet>é</worksheet>");
    }
  });

  it("finds the ZIP directory behind a ZIP comment", async () => {
    const buf = await zip([["xl/workbook.xml", "<w/>"]], true, "written by some tool");
    expect(Object.keys(await unzipXlsx(buf))).toEqual(["xl/workbook.xml"]);
  });

  it("refuses files that are not ZIPs", async () => {
    await expect(unzipXlsx(new TextEncoder().encode("Date,Amount\n1,2").buffer)).rejects.toThrow("Invalid XLSX ZIP");
  });
});

describe("workbookMatrices", () => {
  it("reads every kind of cell Excel writes", async () => {
    const buf = await buildXlsx([
      {
        name: "Data",
        rows: [
          ["text", 12.5, true, { inline: "inline & co" }],
          [{ rich: ["Big ", "Bazaar"] }, { error: "#N/A" }, { formulaText: "42" }, { isoDate: "2025-03-14T00:00:00" }],
          [null, "  spaced  ", "Food &amp; <Drinks>"],
        ],
      },
    ]);
    const [sheet] = await workbookMatrices(buf);
    expect(sheet!.name).toBe("Data");
    const g = sheet!.grid;
    expect(g[0]).toEqual(["text", 12.5, 1, "inline & co"]);
    // Rich text joins its runs and leaves out the phonetic guide
    expect(g[1]![0]).toBe("Big Bazaar");
    expect(g[1]![1]).toBe("#N/A");
    expect(g[1]![2]).toBe(42);
    expect(g[1]![3]).toBe("2025-03-14T00:00:00");
    expect(g[2]![0]).toBeUndefined();
    expect(g[2]![1]).toBe("  spaced  ");
    expect(g[2]![2]).toBe("Food &amp; <Drinks>");
  });

  it("keeps cell positions in a sparse sheet", async () => {
    const buf = await buildXlsx([{ name: "S", startRow: 4, startCol: 27, rows: [["x", null, 5]] }]);
    const [sheet] = await workbookMatrices(buf);
    expect(sheet!.grid.length).toBe(4);
    expect(sheet!.grid[3]![27]).toBe("x");
    expect(sheet!.grid[3]![29]).toBe(5);
    expect(sheet!.grid[0]).toBeUndefined();
  });

  it("follows the tab order and names in workbook.xml, not the file order", async () => {
    const buf = await buildXlsx(
      [
        { name: "Expense", rows: [["a"]] },
        { name: "Income", rows: [["b"]] },
        { name: "Sheet 10", rows: [["c"]] },
      ],
      { shuffleFiles: true },
    );
    expect((await workbookMatrices(buf)).map((s) => s.name)).toEqual(["Expense", "Income", "Sheet 10"]);
  });

  it("falls back to generic names without workbook.xml", async () => {
    const buf = await buildXlsx([{ name: "x", rows: [["a"]] }, { name: "y", rows: [["b"]] }], { noWorkbook: true });
    expect((await workbookMatrices(buf)).map((s) => s.name)).toEqual(["Sheet1", "Sheet2"]);
  });
});

/* =================================================================
   Settings and tables
   ================================================================= */

describe("parseSettings", () => {
  it("reads every list from headings in one of the first rows", () => {
    const s = parseSettings(<SheetMatrix["grid"]>[
      undefined,
      ["Currency", "Ignore Columns", "Ignore Date", "Ignore Particulars", "Ignore Category", "Ignore Mode"],
      ["₹", "Credit", serial("2025-03-14"), "Opening balance", "Transfer", "Wallet"],
      ["USD", "", "01-04-2025", "", " Refund ", ""],
      ["inr", null, "not a date"],
    ]);
    expect(s.found).toBe(true);
    expect(s.currencies).toEqual(["INR", "USD"]);
    expect(s.ignoreColumns).toEqual(["Credit"]);
    expect(s.ignoreDates).toEqual(["2025-03-14", "2025-04-01"]);
    expect(s.ignoreParticulars).toEqual(["Opening balance"]);
    expect(s.ignoreCategories).toEqual(["Transfer", "Refund"]);
    expect(s.ignoreModes).toEqual(["Wallet"]);
  });

  it("reports a sheet without any of the headings as not found", () => {
    expect(parseSettings([["Something"], ["else"]]).found).toBe(false);
    expect(parseSettings([]).currencies).toEqual([]);
  });

  it("only looks for headings in the first 5 rows", () => {
    const grid = [[], [], [], [], [], ["Currency"], ["USD"]];
    expect(parseSettings(grid).found).toBe(false);
  });
});

const HEAD = ["Date", "Particulars", "Amount", "Category", "Mode"];
// Test grids may use null for an empty cell, as a sparse sheet does
type LooseGrid = (unknown[] | undefined)[];
const sheet = (name: string, grid: LooseGrid): SheetMatrix => ({ name, grid: grid as SheetMatrix["grid"] });
const expense = (sheets: SheetMatrix[]) => parseMatrices(sheets, MODULES.expense);
const income = (sheets: SheetMatrix[]) => parseMatrices(sheets, MODULES.income);

describe("parseMatrices: tables", () => {
  it("reads a simple table into records with every derived field", () => {
    const res = expense([
      sheet("Expense", [
        ["2025"],
        HEAD,
        [serial("2025-03-14"), "Milk", 60, "Groceries", "UPI"],
        ["15-03-2025", " Bus ", "25", "Travel", "Cash"],
      ]),
    ]);
    expect(res.skipped.count).toBe(0);
    expect(res.sheetNames).toEqual(["Expense"]);
    expect(res.records).toEqual([
      {
        Date: "2025-03-14",
        Particular: "Milk",
        Amount: 60,
        Principal: null,
        Category: "Groceries",
        Mode: "UPI",
        Currency: "INR",
        Year: "2025",
        Month: "Mar",
        Search: "2025-03-14 milk 60 groceries upi inr 2025 ",
      },
      expect.objectContaining({ Date: "2025-03-15", Particular: "Bus", Amount: 25, Category: "Travel" }),
    ]);
  });

  it("finds the header anywhere in the first 5 rows, in any column order", () => {
    const res = expense([
      sheet("Expense", [
        ["My spending"],
        [],
        ["FY 2024-25"],
        ["mode", "AMOUNT", "category", "date"],
        ["Card", 100, "Food", "01-02-2025"],
      ]),
    ]);
    expect(res.records).toHaveLength(1);
    expect(res.records[0]).toMatchObject({ Mode: "Card", Amount: 100, Category: "Food", Date: "2025-02-01", Year: "2024" });
  });

  it("does not read a header below row 5", () => {
    const grid = [[], [], [], [], [], HEAD, ["01-01-2025", "x", 1, "A", "B"]];
    expect(expense([sheet("Expense", grid)]).records).toHaveLength(0);
  });

  it("reads tables side by side, each with its own year heading", () => {
    const res = expense([
      sheet("Expense", [
        ["2024", null, null, null, null, null, "2025"],
        [...HEAD, null, ...HEAD],
        ["10-12-2024", "Rent", 1000, "Home", "Bank", null, "10-01-2025", "Rent", 1100, "Home", "Bank"],
        [null, null, null, null, null, null, "11-01-2025", "Tea", 20, "Food", "Cash"],
      ]),
    ]);
    expect(res.records.map((r) => [r.Year, r.Amount])).toEqual([
      ["2024", 1000],
      ["2025", 1100],
      ["2025", 20],
    ]);
  });

  it("splits back-to-back tables at a second Date heading", () => {
    const res = expense([
      sheet("Expense", [
        ["2024", null, null, null, null, "2025"],
        [...HEAD, ...HEAD],
        ["10-12-2024", "A", 1, "X", "M", "10-01-2025", "B", 2, "Y", "N"],
      ]),
    ]);
    expect(res.records.map((r) => `${r.Year}:${r.Particular}`)).toEqual(["2024:A", "2025:B"]);
  });

  it("uses the date's own year when there is no year heading", () => {
    const res = expense([sheet("Expense", [HEAD, ["31-12-2024", "x", 5, "A", "B"], ["01-01-2025", "y", 6, "A", "B"]])]);
    expect(res.records.map((r) => r.Year)).toEqual(["2024", "2025"]);
  });

  it("keeps the year heading even for a date in another year (a December table with a January bill)", () => {
    const res = expense([sheet("Expense", [["2024"], HEAD, ["02-01-2025", "Late bill", 10, "Home", "Bank"]])]);
    expect(res.records[0]).toMatchObject({ Year: "2024", Date: "2025-01-02", Month: "Jan" });
  });

  it("adds Credit to Amount, and reads a row that has only one of them", () => {
    const res = expense([
      sheet("Expense", [
        ["Date", "Amount", "Credit", "Category", "Mode"],
        ["01-01-2025", 100, -30, "Food", "Card"],
        ["02-01-2025", null, -40, "Food", "Card"],
        ["03-01-2025", 25, null, "Food", "Card"],
        ["04-01-2025", null, null, "Food", "Card"],
      ]),
    ]);
    expect(res.records.map((r) => r.Amount)).toEqual([70, -40, 25]);
    expect(res.skipped.count).toBe(0);
  });

  it("fills in a missing category or mode", () => {
    const res = expense([sheet("Expense", [HEAD, ["01-01-2025", "x", 5, "", "  "]])]);
    expect(res.records[0]).toMatchObject({ Category: "Uncategorized", Mode: "Unknown" });
  });

  it("skips empty rows quietly and counts unreadable ones with examples", () => {
    const res = expense([
      sheet("Expense", [
        HEAD,
        [],
        [null, "", null, "", ""],
        ["32-01-2025", "bad date", 5, "A", "B"],
        ["01-01-2025", "bad amount", "N/A", "A", "B"],
        [null, "no date", 5, "A", "B"],
        ["02-01-2025", "fine", 5, "A", "B"],
        ["03-01-2025", "x", "abc", "A", "B"],
        ["04-01-2025", "x", "?", "A", "B"],
        ["05-01-2025", "x", "-", "A", "B"],
        ["06-01-2025", "x", "--", "A", "B"],
      ]),
    ]);
    expect(res.records.map((r) => r.Particular)).toEqual(["fine"]);
    expect(res.skipped.count).toBe(7);
    expect(res.skipped.samples).toHaveLength(5);
    expect(res.skipped.samples[0]).toBe('sheet "Expense", row 4');
  });

  it("never reads columns other than the known ones (e.g. Investment)", () => {
    const res = expense([
      sheet("Expense", [["Date", "Amount", "Investment", "Category", "Mode"], ["01-01-2025", 10, 999, "A", "B"]]),
    ]);
    expect(res.records[0]!.Amount).toBe(10);
  });

  it("is safe with headings named like object properties", () => {
    const res = expense([
      sheet("Expense", [
        ["constructor", "Date", "__proto__", "Amount", "Category", "Mode", "toString"],
        ["x", "01-01-2025", "y", 5, "A", "B", "z"],
      ]),
    ]);
    expect(res.records).toHaveLength(1);
    expect(res.records[0]!.Amount).toBe(5);
  });

  it("needs Date, Amount, Category and Mode", () => {
    const res = expense([sheet("Expense", [["Date", "Amount", "Category"], ["01-01-2025", 5, "A"]])]);
    expect(res.records).toHaveLength(0);
  });
});

describe("parseMatrices: modules and settings sheets", () => {
  const workbook = (extra: SheetMatrix[] = []) => [
    sheet("Expense", [HEAD, ["01-01-2025", "Tea", 10, "Food", "Cash"]]),
    sheet("Income", [
      ["Date", "Particulars", "Currency", "Amount", "Principle", "Category", "Mode"],
      ["01-01-2025", "Salary", "₹", 50000, "", "Salary", "Bank"],
      ["15-01-2025", "FD matured", "INR", 1200, 20000, "Interest", "Bank"],
    ]),
    ...extra,
  ];

  it("gives each module only its own sheet", () => {
    expect(expense(workbook()).records.map((r) => r.Particular)).toEqual(["Tea"]);
    expect(income(workbook()).records.map((r) => r.Particular)).toEqual(["Salary", "FD matured"]);
  });

  it("reads Principle but does not add it to the amount", () => {
    const fd = income(workbook()).records[1]!;
    expect(fd.Amount).toBe(1200);
    expect(fd.Principal).toBe(20000);
    expect(fd.Search).toContain("20000");
  });

  it("matches sheet names loosely (case, spaces, dashes)", () => {
    const res = income([sheet(" income ", [HEAD, ["01-01-2025", "x", 1, "A", "B"]]), sheet("Income-Settings", [["Currency"], ["USD"]])]);
    // No Currency column: every row is in the settings sheet's default currency
    expect(res.records.map((r) => r.Currency)).toEqual(["USD"]);
    expect(res.settings.currencies).toEqual(["USD"]);
    expect(res.settingsSheetName).toBe("Income-Settings");
  });

  it("reads an old workbook without module sheets as expenses (every sheet but Settings)", () => {
    const old = [
      sheet("2024", [HEAD, ["01-01-2024", "a", 1, "A", "B"]]),
      sheet("2025", [HEAD, ["01-01-2025", "b", 2, "A", "B"]]),
      sheet("Settings", [["Ignore Category"], ["A"]]),
    ];
    expect(expense(old).records).toHaveLength(0); // category A is ignored by the old Settings sheet
    const noSettings = old.slice(0, 2);
    expect(expense(noSettings).records.map((r) => r.Particular)).toEqual(["a", "b"]);
    expect(income(noSettings).records).toHaveLength(0);
  });

  it("does not treat other sheets as expenses once a module sheet exists", () => {
    const res = expense([sheet("Income", [HEAD]), sheet("Notes", [HEAD, ["01-01-2025", "x", 1, "A", "B"]])]);
    expect(res.records).toHaveLength(0);
  });

  it("leaves out what the settings sheet says to ignore (upper/lower case ignored)", () => {
    const res = expense(
      workbook([
        sheet("Expense_Settings", [
          ["Ignore Particulars", "Ignore Category", "Ignore Mode", "Ignore Date", "Ignore Columns"],
          ["TEA", "", "", "", "Particulars"],
        ]),
      ]),
    );
    // "Particulars" column ignored -> the particular is "", so "TEA" no longer matches
    expect(res.records).toHaveLength(1);
    expect(res.records[0]!.Particular).toBe("");
  });

  it("cannot ignore the Date or Amount columns", () => {
    const res = expense(workbook([sheet("Expense_Settings", [["Ignore Columns"], ["Date"], ["Amount"]])]));
    expect(res.records).toHaveLength(1);
  });

  it("ignores listed dates", () => {
    const res = expense(workbook([sheet("Expense_Settings", [["Ignore Date"], ["01-01-2025"]])]));
    expect(res.records).toHaveLength(0);
  });

  it("reads only the listed currencies and uses the first as the default", () => {
    const res = income([
      sheet("Income", [
        ["Date", "Currency", "Amount", "Category", "Mode"],
        ["01-01-2025", "$", 10, "A", "B"],
        ["02-01-2025", "EUR", 20, "A", "B"],
        ["03-01-2025", "jpy", 30, "A", "B"],
      ]),
      sheet("Income_Settings", [["Currency"], ["USD"], ["¥"]]),
    ]);
    expect(res.records.map((r) => r.Currency)).toEqual(["USD", "JPY"]);
  });

  it("gives a row with an empty Currency cell the default currency", () => {
    const res = income([
      sheet("Income", [["Date", "Currency", "Amount", "Category", "Mode"], ["01-01-2025", "", 10, "A", "B"]]),
      sheet("Income_Settings", [["Currency"], ["USD"]]),
    ]);
    expect(res.records.map((r) => r.Currency)).toEqual(["USD"]);
  });

  it("uses the settings default currency when the table has no Currency column", () => {
    const res = expense(workbook([sheet("Expense_Settings", [["Currency"], ["JPY"]])]));
    expect(res.records[0]!.Currency).toBe("JPY");
  });
});
