import { registerSW } from "virtual:pwa-register";
import { $ } from "./utils";

/* =========================================================================
pwa.ts
Offline / installable app: registers the service worker that vite-plugin-pwa
builds (see vite.config.ts). Loaded by main.ts in the built site only.

The service worker keeps a copy of the app itself, never of a workbook.
- First visit: once the copy is stored, a short note says the app now works
  offline.
- After a new version is published: the note offers "Reload". The page is
  never reloaded on its own, because a reload clears the loaded workbook.
========================================================================= */

function showNote(text: string, reload: (() => void) | null): void {
  const note = $("appNote");
  $("appNoteText").textContent = text;
  const reloadBtn = $<HTMLButtonElement>("appNoteReload");
  reloadBtn.hidden = !reload;
  reloadBtn.onclick = reload;
  $("appNoteClose").onclick = () => (note.hidden = true);
  note.hidden = false;
}

export function setupPwa(): void {
  const update = registerSW({
    onNeedRefresh() {
      showNote("A new version of the app is ready. Reloading clears the loaded workbook.", () => void update(true));
    },
    onOfflineReady() {
      showNote("Ready to work offline. You can also install it from the browser menu.", null);
      setTimeout(() => ($("appNote").hidden = true), 8000);
    },
  });
}
