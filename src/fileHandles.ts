/* =========================================================================
fileHandles.ts
Remembers WHICH files were picked (not what is in them), so a Refresh button
can read the same files again after they were edited in Excel.

Uses the File System Access API (Edge, Chrome): the picker gives file
handles, which are kept in this browser's IndexedDB. A handle is only a
reference; the file stays where it is and is read on this device. Nothing is
uploaded. A new browser session asks for permission again (one click on
Allow). Firefox and Safari do not have the API: canKeepFiles() is false, the
normal file input is used and the Refresh button stays hidden.
========================================================================= */

type ReadMode = { mode: "read" };

/** A picked file: the standard handle plus the permission methods. */
export type KeptFile = FileSystemFileHandle & {
  queryPermission(options: ReadMode): Promise<PermissionState>;
  requestPermission(options: ReadMode): Promise<PermissionState>;
};

interface PickerWindow {
  showOpenFilePicker?: (options: {
    multiple: boolean;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle[]>;
}

const picker = (): PickerWindow["showOpenFilePicker"] => (window as unknown as PickerWindow).showOpenFilePicker;

/** Can this browser keep file handles? (false in Firefox / Safari) */
export const canKeepFiles = (): boolean => typeof picker() === "function" && typeof indexedDB !== "undefined";

/** Ask for the workbooks. null = the picker was closed without a choice. */
export async function pickFiles(): Promise<KeptFile[] | null> {
  try {
    const handles = await picker()!.call(window, {
      multiple: true,
      types: [{ description: "Excel workbooks", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }],
    });
    return handles as KeptFile[];
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

/* ------------ IndexedDB ------------ */

const DB_NAME = "finance-analytics";
const STORE = "files";
const KEY = "picked";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Keep these handles for the next Refresh (and the next visit). */
export async function saveFiles(handles: KeptFile[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(handles, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Storage blocked (e.g. a private window): Refresh simply is not offered next time
  }
}

/** The handles kept earlier (empty when none, or when storage is blocked). */
export async function savedFiles(): Promise<KeptFile[]> {
  try {
    const db = await openDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return Array.isArray(value) ? (value as KeptFile[]) : [];
  } catch {
    return [];
  }
}

/** Why the files could not be read: the user did not allow it, or a file is gone. */
export class RefreshError extends Error {}

/**
 * Read the files again. The browser may show an "Allow" prompt (once per
 * session); this must run from a click.
 */
export async function readFiles(handles: KeptFile[]): Promise<File[]> {
  for (const h of handles) {
    let state = await h.queryPermission({ mode: "read" });
    if (state !== "granted") state = await h.requestPermission({ mode: "read" });
    if (state !== "granted") throw new RefreshError(`access to ${h.name} was not allowed. Click Refresh again and choose Allow`);
  }
  try {
    return await Promise.all(handles.map((h) => h.getFile()));
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") {
      throw new RefreshError("a file was moved, renamed or deleted. Use Load Excel to pick it again");
    }
    throw e;
  }
}
