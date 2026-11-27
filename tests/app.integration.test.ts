/* End to end: the real page, the real start-up code, and real .xlsx files
   chosen in the file input, exactly as a person uses the app. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildXlsx, fileOf } from "./helpers/xlsx";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string) => $(id).textContent!.replace(/\s+/g, " ").trim();
const tight = (id: string) => $(id).textContent!.replace(/\s+/g, "");
const visible = (id: string) => !$(id).hidden;
const click = (el: Element | null) => {
  if (!el) throw new Error("element not found");
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

// Choose files in the "Load Excel" input and wait until they are read
async function choose(...files: File[]) {
  const input = $<HTMLInputElement>("file");
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await (input.onchange as (e: Event) => Promise<void>)({ target: input } as unknown as Event);
}

async function financeWorkbook() {
  const EXP = ["Date", "Particulars", "Amount", "Category", "Mode"];
  const INC = ["Date", "Particulars", "Currency", "Amount", "Principle", "Category", "Mode"];
  return fileOf(
    await buildXlsx([
      {
        name: "Expense",
        rows: [
          ["2026", null, null, null, null, null, "2025"],
          [...EXP, null, ...EXP],
          ["05-01-2026", "Rent Jan", 20000, "Rent", "Bank", null, "05-12-2025", "Rent Dec", 20000, "Rent", "Bank"],
          ["10-01-2026", "Groceries", "Rs. 4,500/-", "Food", "UPI", null, "24-12-2025", "Gifts", 6000, "Gifts", "Card"],
          ["05-02-2026", "Rent Feb", 20000, "Rent", "Bank", null, "31-12-2025", "Bad row", "N/A", "Food", "Cash"],
          ["14-Feb-26", "Dinner", "(500)", "Food", "Card"],
        ],
      },
      {
        name: "Income",
        rows: [
          INC,
          ["01-12-2025", "Salary", "₹", 60000, null, "Salary", "Bank"],
          ["01-01-2026", "Salary", "", 60000, null, "Salary", "Bank"],
          ["01-02-2026", "Salary", "INR", 62000, null, "Salary", "Bank"],
          ["15-02-2026", "FD matured", "INR", 1500, 25000, "Interest", "Bank"],
          ["01-02-2026", "Freelance", "USD", 300, null, "Work", "PayPal"],
        ],
      },
      { name: "Income_Settings", rows: [["Currency"], ["INR"], ["USD"]] },
      { name: "Expense_Settings", rows: [["Ignore Particulars"], ["Opening balance"]] },
    ]),
    "finance.xlsx",
  );
}

async function marketWorkbook() {
  return fileOf(
    await buildXlsx([
      {
        name: "Orders",
        rows: [
          ["Date", "Order", "Holding", "Units", "UnitAvg", "LotValue", "Charges"],
          ["01-01-2025", "Buy", "AAA", 10, 100, 1000, 2],
          ["01-06-2025", "Buy", "BBB", 5, 200, 1000, 2],
          ["01-03-2026", "Sell", "AAA", 4, 150, 600, 1],
        ],
      },
      { name: "Sheet2", rows: [["Holding", "LTP", "Category"], ["AAA", 120, "ETF"], ["BBB", 180, "Stock"]] },
    ]),
    "market.xlsx",
  );
}

beforeAll(async () => {
  await import("../src/main");
});

describe("the app before a file is loaded", () => {
  it("shows the empty Expense page without errors", () => {
    expect(text("pageTitle")).toBe("Expense");
    expect(text("fileName")).toBe("No workbook loaded");
    expect(text("insights")).toContain("Load a workbook");
    expect($("tbody").children).toHaveLength(0);
  });

  it("shows a welcome card instead of empty charts", () => {
    const app = document.querySelector(".app")!;
    expect(app.classList.contains("no-data")).toBe(true);
    expect(app.classList.contains("module-empty")).toBe(true);
    expect(visible("moduleEmpty")).toBe(true);
    expect(text("moduleEmpty")).toContain("See where your money goes");
    // The Load Excel button there opens the same file input
    expect($("moduleEmpty").querySelector("label[for='file']")).not.toBeNull();
    expect($("moduleEmpty").querySelector<HTMLAnchorElement>("a[download]")!.getAttribute("href")).toBe("sample-workbook.xlsx");
  });

  it("states that the data stays in the browser, in the welcome card and the side bar", () => {
    expect(text("moduleEmpty")).toContain("Your data stays on this device");
    expect(text("moduleEmpty")).toContain("Nothing is uploaded");
    const note = document.querySelector(".side .privacy-note")!;
    expect(note.textContent).toContain("Private: stays on this device");
    expect(note.textContent).toContain("never uploaded");
  });

  it("shows empty states on the Overview and Market pages", () => {
    click(document.querySelector(".side-item[data-page='overview']"));
    expect(tight("ovBody")).toContain("Income and spending, side by side".replace(/\s+/g, ""));
    click(document.querySelector(".side-item[data-page='market']"));
    expect(text("mkBody")).toContain("Track your investments");
    expect($("mkBody").querySelector("label[for='file']")).not.toBeNull();
    click(document.querySelector(".side-item[data-module='expense']"));
  });
});

describe("while a workbook is read", () => {
  it("shows a loading panel, then hides it", async () => {
    const input = $<HTMLInputElement>("file");
    Object.defineProperty(input, "files", { value: [await financeWorkbook()], configurable: true });
    const done = (input.onchange as (e: Event) => Promise<void>)({ target: input } as unknown as Event);
    expect(visible("loading")).toBe(true);
    expect(text("loadingText")).toBe("Reading finance.xlsx");
    expect(text("loading")).toContain("Nothing is uploaded");
    await done;
    expect(visible("loading")).toBe(false);
    expect(document.querySelector(".app")!.hasAttribute("aria-busy")).toBe(false);
  });
});

describe("loading a messy workbook", () => {
  beforeAll(async () => {
    await choose(await financeWorkbook());
  });

  it("replaces the welcome card with the dashboard", () => {
    const app = document.querySelector(".app")!;
    expect(app.classList.contains("no-data")).toBe(false);
    expect(app.classList.contains("module-empty")).toBe(false);
    expect(visible("moduleEmpty")).toBe(false);
  });

  it("opens the Overview when there are both income and expenses", () => {
    expect(visible("overviewPage")).toBe(true);
    expect(visible("modulePage")).toBe(false);
    expect(text("fileName")).toBe("finance.xlsx");
    // February 2026: income 62,000 + 1,500 (INR only), expenses 20,000 - 500
    const cards = tight("ovBody");
    expect(cards).toContain("Income₹63,500");
    expect(cards).toContain("Expenses₹19,500");
    expect(cards).toContain("Netsaved₹44,000");
    expect(cards).toContain("Savingsrate69%");
    expect(text("ovSub")).toContain("Feb 2026");
  });

  it("offers both currencies of the workbook", () => {
    const options = [...document.querySelectorAll<HTMLInputElement>("#currency input")].map((i) => i.value);
    expect(options).toEqual(["INR", "USD"]);
  });

  it("switches the Overview to a whole year", () => {
    click(document.querySelector("#ovPeriod button[data-period='year']"));
    expect(text("ovSub")).toContain("2026 (Jan–Feb)");
    // Jan 60,000 + Feb 63,500; December 2025 belongs to last year
    expect(tight("ovBody")).toContain("Income₹1,23,500");
    click(document.querySelector("#ovPeriod button[data-period='month']"));
  });

  it("shows the Expense page with the right totals and the skipped row", () => {
    click(document.querySelector(".side-item[data-module='expense']"));
    expect(visible("modulePage")).toBe(true);
    const kpis = [...document.querySelectorAll(".kpi")].map((k) => k.textContent!.replace(/\s+/g, " ").trim());
    // 20000 + 4500 + 20000 - 500 + 20000 + 6000 = 70,000
    expect(kpis[0]).toContain("Total expense");
    expect(kpis[0]).toContain("₹70,000");
    expect(kpis[3]).toContain("3"); // Rent, Food, Gifts
    expect(text("err")).toContain("1 row was skipped");
    expect(text("err")).toContain('sheet "Expense", row 5');
    // One table row per record
    expect(document.querySelectorAll("#tbody tr.vrow")).toHaveLength(6);
  });

  it("filters every section when a bar is clicked, and the search narrows it", () => {
    click(document.querySelector("#catbars button[data-val='Food']"));
    expect(document.querySelectorAll("#tbody tr.vrow")).toHaveLength(2);
    expect(text("insights")).toContain("₹4,000"); // 4500 - 500
    const search = $<HTMLInputElement>("search");
    search.value = "dinner";
    click($("dashReset"));
    expect(search.value).toBe("");
    expect(document.querySelectorAll("#tbody tr.vrow")).toHaveLength(6);
  });

  it("opens a calendar day with its transactions", () => {
    // The calendar shows the latest year: 2026
    const day = document.querySelector<HTMLElement>("#heatmap [data-date='2026-01-05'], #heatmapLast [data-date='2026-01-05']");
    click(day);
    expect($<HTMLDialogElement>("dayDialog").open).toBe(true);
    expect(text("dayDialogSummary")).toBe("1 transaction · ₹20,000");
    click($("dayDialogClose"));
  });

  it("shows the Income page in each currency", () => {
    click(document.querySelector(".side-item[data-module='income']"));
    expect(text("pageTitle")).toBe("Income");
    const total = () => document.querySelector(".kpi")!.textContent!.replace(/\s+/g, " ");
    expect(total()).toContain("₹1,83,500"); // empty Currency cell counts as INR (the default)
    const usd = document.querySelector<HTMLInputElement>("#currency input[value='USD']")!;
    usd.checked = true;
    $("currency").dispatchEvent(new Event("change", { bubbles: true }));
    // currency.onchange reads e.target
    ($("currency").onchange as (e: Event) => void)({ target: usd } as unknown as Event);
    expect(total()).toContain("$300");
  });

  it("lists the settings read from the workbook", () => {
    click($("settingsBtn"));
    expect(text("settingsNote")).toContain('Read from the "Income_Settings" sheet');
    expect(text("settingsBody")).toContain("₹ INR (default)");
    click($("settingsClose"));
  });
});

describe("loading the market file next to it", () => {
  beforeAll(async () => {
    await choose(await marketWorkbook());
  });

  it("keeps the finance workbook and adds the market data", () => {
    expect(text("fileName")).toBe("finance.xlsx · market.xlsx");
    expect(document.querySelector("[data-count='market']")!.textContent).toBe("2");
  });

  it("shows the Market page with holdings worked out from the orders", () => {
    click(document.querySelector(".side-item[data-page='market']"));
    expect(visible("marketPage")).toBe(true);
    const body = tight("mkBody");
    // AAA: 6 left at avg 100 = 600, BBB: 5 at 200 = 1000 -> invested 1,600
    expect(body).toContain("Investednow₹1,600");
    // 6 x 120 + 5 x 180 = 1,620
    expect(body).toContain("Currentvalue₹1,620");
    // Sold 4 AAA at 150 that cost 100: booked +200
    expect(body).toContain("booked+₹200");
    expect(body).toContain("Chargespaidonallorders:₹5");
  });
  it("goes back and forth between Market and the module pages", () => {
    const page = () =>
      ["modulePage", "overviewPage", "marketPage"].find(visible) + (visible("modulePage") ? ":" + text("pageTitle") : "");
    const go = (sel: string) => click(document.querySelector(`.side-item${sel}`));
    // Income was the module shown before Market: it must open again
    go("[data-module='income']");
    expect(page()).toBe("modulePage:Income");
    go("[data-page='market']");
    expect(page()).toBe("marketPage");
    go("[data-module='expense']");
    expect(page()).toBe("modulePage:Expense");
    go("[data-page='market']");
    go("[data-module='expense']");
    expect(page()).toBe("modulePage:Expense");
    go("[data-page='overview']");
    go("[data-module='expense']");
    expect(page()).toBe("modulePage:Expense");
    go("[data-page='market']");
    expect(page()).toBe("marketPage");
  });
});

describe("files that cannot be read", () => {
  it("explains the problem instead of failing silently", async () => {
    await choose(new File(["Date,Amount\n01-01-2026,5"], "money.csv"));
    expect(text("err")).toContain("Could not read the workbook");
    expect(text("err")).toContain("Invalid XLSX ZIP");
    // The data already loaded is kept
    expect(text("fileName")).toBe("finance.xlsx · market.xlsx");
    expect($("uploadText").textContent).toBe("Load Excel");
  });

  it("says when a workbook has no usable rows", async () => {
    await choose(fileOf(await buildXlsx([{ name: "Notes", rows: [["hello"]] }]), "empty.xlsx"));
    expect(text("err")).toContain("no usable rows");
  });
});

describe("the sample workbook shipped with the app", () => {
  it("loads without skipped rows or errors", async () => {
    const buf = readFileSync(resolve(__dirname, "../public/sample-workbook.xlsx"));
    await choose(new File([buf], "sample-workbook.xlsx"));
    expect(text("fileName")).toContain("sample-workbook.xlsx");
    expect(visible("overviewPage")).toBe(true);
    expect(text("ovBody")).toContain("Income");
    click(document.querySelector(".side-item[data-module='expense']"));
    expect($("err").textContent).toBe("");
    expect(document.querySelectorAll("#tbody tr.vrow").length).toBeGreaterThan(0);
    click(document.querySelector(".side-item[data-page='networth']"));
    expect(visible("networthPage")).toBe(true);
    expect(text("nwSub")).toContain('"Accounts" sheet');
    expect(text("nwSub")).not.toContain("skipped");
    expect(document.querySelectorAll("#nwBody .nw-table tbody tr").length).toBeGreaterThan(5);
  });
});

describe("a workbook with expenses only", () => {
  it("explains on the Income page which sheet is missing", async () => {
    await choose(
      fileOf(
        await buildXlsx([{ name: "Expense", rows: [["Date", "Amount", "Category", "Mode"], ["01-01-2026", 100, "Food", "Cash"]] }]),
        "expenses.xlsx",
      ),
    );
    click(document.querySelector(".side-item[data-module='income']"));
    expect(visible("moduleEmpty")).toBe(true);
    expect(text("moduleEmpty")).toContain("No income rows yet");
    expect(text("moduleEmpty")).toContain('no "Income" sheet');
    expect(document.querySelector(".app")!.classList.contains("no-data")).toBe(false);
    click(document.querySelector(".side-item[data-module='expense']"));
    expect(visible("moduleEmpty")).toBe(false);
  });
});

describe("the Net worth page", () => {
  async function accountsWorkbook() {
    return fileOf(
      await buildXlsx([
        {
          name: "Accounts",
          rows: [
            ["2026"],
            ["Date", "Account", "Type", "Balance"],
            ["31-01-2026", "HDFC", "Bank", 100000],
            ["31-01-2026", "Home loan", "Loan", 300000],
            ["31-01-2026", "Flat", "Property", 500000],
            ["28-02-2026", "HDFC", "Bank", 120000],
            ["28-02-2026", "Home loan", "Loan", 290000],
          ],
        },
      ]),
      "accounts.xlsx",
    );
  }

  it("opens when a workbook has only an Accounts sheet", async () => {
    await choose(await accountsWorkbook());
    expect(visible("networthPage")).toBe(true);
    expect(visible("modulePage")).toBe(false);
    expect(document.querySelector(".side-item[data-page='networth']")!.getAttribute("aria-current")).toBe("page");
    // 1,20,000 + 5,00,000 − 2,90,000, plus the market file loaded earlier at today's prices (1,620)
    expect(tight("nwBody")).toContain("₹3,31,620");
    expect(text("nwBody")).toContain("Accounts · Nov 2026");
    expect(document.querySelector("[data-count='networth']")!.textContent).toBe("3");
    expect(document.querySelectorAll("#nwBody .nw-table tbody tr")).toHaveLength(4);
  });

  it("picks a month from the chart", () => {
    click(document.querySelector(`#nwBody .nw-month[data-month='${2026 * 12}']`));
    expect(text("nwBody")).toContain("Accounts · Jan 2026");
    expect(text("nwBody")).toContain("What changed since Dec 2025");
    // 1,00,000 + 5,00,000 − 3,00,000, plus the market at cost on 31 Jan (2,000)
    expect(tight("nwBody")).toContain("Networth₹3,02,000");
    expect(text("nwBody")).toContain("at cost, 31-01-2026");
  });

  it("stays on the page and goes back to the newest month when a file is loaded again", async () => {
    await choose(await marketWorkbook());
    expect(visible("networthPage")).toBe(true);
    expect(text("nwSub")).toContain("market file");
    expect(text("nwBody")).toContain("Accounts · Nov 2026");
    expect(text("nwBody")).toContain("today's prices");
  });
});
