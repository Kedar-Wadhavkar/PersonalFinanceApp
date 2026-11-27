/* The "Recurring bills & anomalies" card on the real page, with a real
   .xlsx file chosen in the file input. */
import { beforeAll, describe, expect, it } from "vitest";
import { buildXlsx, fileOf, type Cell } from "./helpers/xlsx";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string) => $(id).textContent!.replace(/\s+/g, " ").trim();
const click = (el: Element | null) => {
  if (!el) throw new Error("element not found");
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

async function choose(file: File) {
  const input = $<HTMLInputElement>("file");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await (input.onchange as (e: Event) => Promise<void>)({ target: input } as unknown as Event);
}

const d = (month: number, day: number) => `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-2026`;

async function workbook() {
  const EXP = ["Date", "Particulars", "Amount", "Category", "Mode"];
  const rows: Cell[][] = [["2026"], EXP];
  for (let m = 1; m <= 10; m++) {
    rows.push([d(m, 1), `Rent ${m}`, 20000, "Rent", "Bank"]);
    rows.push([d(m, 12), "NETFLIX.COM", 649, "Entertainment", "Card"]);
    rows.push([d(m, 3), "Groceries", 400 + (m % 4) * 50, "Food", "UPI"]);
    rows.push([d(m, 18), "Groceries", 450, "Food", "UPI"]);
  }
  rows.push([d(10, 25), "Diwali feast", 6000, "Food", "Card"]);
  const INC = ["Date", "Particulars", "Currency", "Amount", "Principle", "Category", "Mode"];
  return fileOf(
    await buildXlsx([
      { name: "Expense", rows },
      { name: "Income", rows: [INC, [d(1, 1), "Salary", "INR", 90000, null, "Salary", "Bank"]] },
    ]),
    "bills.xlsx",
  );
}

beforeAll(async () => {
  await import("../src/main");
});

describe("before a workbook is loaded", () => {
  it("hides the card behind the welcome state", () => {
    expect(document.querySelector(".app")!.classList.contains("module-empty")).toBe(true);
    expect($("recurringBody").textContent).toBe("");
  });
});

describe("with an Expense sheet", () => {
  beforeAll(async () => {
    await choose(await workbook());
    click(document.querySelector(".side-item[data-module='expense']"));
  });

  it("shows the card and its link on the Expense page", () => {
    expect($("secRecurring").hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('.side-item[href="#secRecurring"]')!.hidden).toBe(false);
  });

  it("shows the total yearly cost of the subscriptions and bills", () => {
    // Rent 20,000 × 12 + Netflix 649 × 12
    expect(text("rbAnnual").replace(/\s/g, "")).toBe("₹2,47,788");
    expect(text("recurringBody")).toContain("Active recurring2");
  });

  it("lists the recurring bills", () => {
    const rows = [...$("secRecurring").querySelectorAll(".rb-table tbody tr")].map((tr) => tr.textContent!.replace(/\s+/g, " ").trim());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^Rent 10Rent · 10 payments Monthly ₹20,000 01-10-2026 01-11-2026 ₹2,40,000$/);
    expect(rows[1]).toContain("NETFLIX.COM");
    expect(rows[1]).toContain("12-11-2026");
  });

  it("flags the unusually high entry", () => {
    const items = $("secRecurring").querySelectorAll(".rb-anomaly");
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("Diwali feast");
    expect(items[0]!.classList.contains("rb-high")).toBe(true);
    expect(text("recurringBody")).toContain("Unusual entries1");
  });

  it("searches the transactions table when an entry is clicked", () => {
    click($("secRecurring").querySelector(".rb-anomaly"));
    expect($<HTMLInputElement>("search").value).toBe("Diwali feast");
    click($("secRecurring").querySelector(".rb-find"));
    expect($<HTMLInputElement>("search").value).toBe("Rent 10");
    click($("recurringBody")); // not on an entry: nothing happens
    expect($<HTMLInputElement>("search").value).toBe("Rent 10");
  });

  it("is hidden on the Income page", () => {
    click(document.querySelector(".side-item[data-module='income']"));
    expect($("secRecurring").hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.side-item[href="#secRecurring"]')!.hidden).toBe(true);
    click(document.querySelector(".side-item[data-module='expense']"));
    expect($("secRecurring").hidden).toBe(false);
  });
});

describe("with nothing recurring or unusual", () => {
  it("says so instead of showing empty lists", async () => {
    const EXP = ["Date", "Particulars", "Amount", "Category", "Mode"];
    await choose(
      fileOf(
        await buildXlsx([{ name: "Expense", rows: [["2026"], EXP, [d(1, 5), "Books", 300, "Shopping", "Cash"], [d(2, 9), "Shoes", 2500, "Shopping", "Card"]] }]),
        "plain.xlsx",
      ),
    );
    click(document.querySelector(".side-item[data-module='expense']"));
    expect(text("recurringBody")).toContain("No payments repeat monthly or yearly");
    expect(text("recurringBody")).toContain("Nothing stands out");
    expect(text("rbAnnual").replace(/\s/g, "")).toBe("₹0");
  });
});

describe("with a stopped bill and many anomalies", () => {
  it("dims the stopped bill and shortens the anomaly list", async () => {
    const EXP = ["Date", "Particulars", "Amount", "Category", "Mode"];
    const BIG = ["Laptop", "Sofa", "Flight", "Watch", "Phone", "Camera", "Ring", "Bike", "Course", "Tablet"];
    const rows: Cell[][] = [["2026"], EXP];
    for (let m = 1; m <= 4; m++) rows.push([d(m, 20), "Gym membership", 1500, "Health", "Card"]);
    for (let c = 1; c <= 10; c++) {
      for (let day = 1; day <= 6; day++) rows.push([d(c, day), `Item ${c}.${day}`, 100, `Cat ${c}`, "Cash"]);
      rows.push([d(c, 15), BIG[c - 1]!, 2000 + c, `Cat ${c}`, "Card"]);
    }
    await choose(fileOf(await buildXlsx([{ name: "Expense", rows }]), "many.xlsx"));
    click(document.querySelector(".side-item[data-module='expense']"));

    const stale = $("secRecurring").querySelector(".rb-stale")!;
    expect(stale.textContent).toContain("Gym membership");
    expect(stale.textContent).toContain("stopped?");
    expect(text("rbAnnual").replace(/\s/g, "")).toBe("₹0"); // a stopped bill is not counted
    expect($("secRecurring").querySelectorAll(".rb-anomaly")).toHaveLength(8);
    expect(text("recurringBody")).toContain("and 2 more");
    expect(text("recurringBody")).toContain("20× the usual ₹100");
  });
});
