/* Builds real .xlsx files (ZIP + XML) inside the tests, so the parser is
   tested on the same bytes Excel writes, including the messy variants. */

export type Cell =
  | string
  | number
  | boolean
  | null
  | undefined
  /** A cell written in a particular way */
  | { inline: string } // t="inlineStr"
  | { rich: string[] } // shared string made of several formatted runs
  | { error: string } // t="e", e.g. #N/A
  | { formulaText: string } // t="str" (text result of a formula)
  | { isoDate: string }; // t="d"

export interface SheetSpec {
  name: string;
  rows: Cell[][];
  /** First row number (1-based) of rows[0]; lets a table start lower down */
  startRow?: number;
  /** First column (0 = A) of every row */
  startCol?: number;
}

export interface BuildOptions {
  /** Deflate the parts (as Excel does) or store them */
  compress?: boolean;
  /** Write the sheets' files in reverse order, to check tab order is read from workbook.xml */
  shuffleFiles?: boolean;
  /** Leave out workbook.xml and its .rels (generic sheet names are used) */
  noWorkbook?: boolean;
  /** Text in front of the ZIP (some tools add a header); not normally used */
  zipComment?: string;
}

const enc = new TextEncoder();

export function colName(i: number): string {
  let s = "";
  i++;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

const escXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function sheetXml(spec: SheetSpec, shared: string[]): string {
  const sharedIndex = (s: string) => {
    let i = shared.indexOf(s);
    if (i < 0) i = shared.push(s) - 1;
    return i;
  };
  const start = spec.startRow ?? 1;
  const c0 = spec.startCol ?? 0;
  const rowsXml = spec.rows
    .map((cells, ri) => {
      const r = start + ri;
      const cellsXml = cells
        .map((v, ci) => {
          const ref = `${colName(c0 + ci)}${r}`;
          if (v === null || v === undefined) return "";
          if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
          if (typeof v === "boolean") return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
          if (typeof v === "string") return `<c r="${ref}" t="s"><v>${sharedIndex(v)}</v></c>`;
          if ("inline" in v) return `<c r="${ref}" t="inlineStr"><is><t>${escXml(v.inline)}</t></is></c>`;
          if ("rich" in v) return `<c r="${ref}" t="s"><v>${sharedIndex("\u0000RICH" + JSON.stringify(v.rich))}</v></c>`;
          if ("error" in v) return `<c r="${ref}" t="e"><v>${escXml(v.error)}</v></c>`;
          if ("formulaText" in v) return `<c r="${ref}" t="str"><f>A1</f><v>${escXml(v.formulaText)}</v></c>`;
          return `<c r="${ref}" t="d"><v>${v.isoDate}</v></c>`;
        })
        .join("");
      return `<row r="${r}">${cellsXml}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
}

function sharedXml(shared: string[]): string {
  const items = shared
    .map((s) => {
      if (s.startsWith("\u0000RICH")) {
        const runs = JSON.parse(s.slice(5)) as string[];
        return `<si>${runs.map((t) => `<r><rPr><b/></rPr><t xml:space="preserve">${escXml(t)}</t></r>`).join("")}<rPh sb="0" eb="1"><t>ignored</t></rPh></si>`;
      }
      return `<si><t xml:space="preserve">${escXml(s)}</t></si>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${items}</sst>`;
}

/* ---- ZIP writer ---- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function zip(files: [string, string][], compress = true, comment = ""): Promise<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(text);
    const body = compress ? await deflateRaw(raw) : raw;
    const crc = crc32(raw);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, compress ? 8 : 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, body);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(10, compress ? 8 : 0, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const commentBytes = enc.encode(comment);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, commentBytes.length, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer), commentBytes];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out.buffer;
}

/** A complete .xlsx file with the given sheets, as an ArrayBuffer. */
export async function buildXlsx(sheets: SheetSpec[], options: BuildOptions = {}): Promise<ArrayBuffer> {
  const shared: string[] = [];
  const sheetFiles: [string, string][] = sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, shared)]);
  const files: [string, string][] = [
    ["[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`],
  ];
  if (!options.noWorkbook) {
    files.push([
      "xl/workbook.xml",
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${escXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ]);
    files.push([
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}</Relationships>`,
    ]);
  }
  files.push(...(options.shuffleFiles ? [...sheetFiles].reverse() : sheetFiles));
  if (shared.length) files.push(["xl/sharedStrings.xml", sharedXml(shared)]);
  return zip(files, options.compress ?? true, options.zipComment);
}

/** Excel's day number for a calendar date (1900 date system). */
export const serial = (iso: string): number => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;

/** A File, as the file input hands it to the app. */
export const fileOf = (buf: ArrayBuffer, name: string): File => new File([buf], name);
