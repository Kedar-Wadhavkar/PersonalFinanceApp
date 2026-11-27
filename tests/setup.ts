/* Test setup: runs before every test file.
   - puts the real page (index.html) into the test DOM, because the app's
     modules look up their elements by id when they load
   - fixes the clock and time zone, so "today" never changes a result
   - stands in for the few browser features the test DOM does not have */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";

process.env.TZ = "UTC";
vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-20T10:00:00Z") });

const html = readFileSync(resolve(__dirname, "../index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "");

// Canvas text measuring (used to wrap chart labels): about 6px per character
HTMLCanvasElement.prototype.getContext = function () {
  return { font: "", measureText: (s: string) => ({ width: s.length * 6 }) };
} as unknown as HTMLCanvasElement["getContext"];

// <dialog> pop-ups
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};
Element.prototype.scrollIntoView ??= () => {};
window.scrollTo = () => {};
