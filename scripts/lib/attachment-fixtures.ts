/**
 * Small, real files of every supported attachment format — and a few that
 * only pretend — built in memory for `check-attachments.ts`.
 *
 * Nothing is read from disk and nothing is committed as a binary: an image is
 * drawn by sharp, a PDF is written out object by object, and the Office
 * formats are zipped from the handful of parts each needs to be a valid
 * document. Run this file directly to write the set to a folder, for trying
 * the upload and the previews by hand:
 *
 *   npx tsx scripts/lib/attachment-fixtures.ts <folder>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { strToU8, zipSync } from "fflate";
import sharp from "sharp";

export type Fixture = { name: string; bytes: Uint8Array };

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** A picture with enough in it to tell which way up it is. */
async function picture(width: number, height: number, hue: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="${hue}"/>
    <rect x="6%" y="8%" width="34%" height="26%" fill="#f6f4ef"/>
    <circle cx="72%" cy="62%" r="${Math.round(Math.min(width, height) * 0.2)}" fill="#1f4a3d"/>
  </svg>`;
  return sharp(Buffer.from(svg));
}

export async function pngFixture(name = "bilde.png", width = 1200, height = 800, hue = "#d9cfc0"): Promise<Fixture> {
  return { name, bytes: new Uint8Array(await (await picture(width, height, hue)).png().toBuffer()) };
}

export async function jpegFixture(name = "foto.jpg", width = 1600, height = 1000, hue = "#2f5a73"): Promise<Fixture> {
  return { name, bytes: new Uint8Array(await (await picture(width, height, hue)).jpeg({ quality: 82 }).toBuffer()) };
}

/** Stored on its side, with the EXIF flag that tells a viewer to turn it. */
export async function rotatedJpegFixture(name = "portrett.jpg"): Promise<Fixture> {
  const image = (await picture(1200, 800, "#99442a")).jpeg({ quality: 82 }).withMetadata({ orientation: 6 });
  return { name, bytes: new Uint8Array(await image.toBuffer()) };
}

export async function webpFixture(name = "grafikk.webp"): Promise<Fixture> {
  return { name, bytes: new Uint8Array(await (await picture(900, 900, "#e8efea")).webp().toBuffer()) };
}

export async function gifFixture(name = "figur.gif"): Promise<Fixture> {
  return { name, bytes: new Uint8Array(await (await picture(320, 240, "#efebe3")).gif().toBuffer()) };
}

/** What a stripped image must no longer contain anywhere in its bytes. */
export const METADATA_SECRET = "TINGCAM-SECRET";

const CAMERA_EXIF = {
  IFD0: { Make: METADATA_SECRET, Model: "Testkamera" },
  IFD3: {
    GPSLatitudeRef: "N",
    GPSLatitude: "59/1 54/1 36/1",
    GPSLongitudeRef: "E",
    GPSLongitude: "10/1 44/1 24/1",
  },
};

/** A photo as a phone writes it: on its side, with the camera and the place in EXIF. */
export async function gpsJpegFixture(name = "mobilbilde.jpg", progressive = false): Promise<Fixture> {
  const image = (await picture(1200, 800, "#4c5b34")).jpeg({ quality: 84, progressive }).withMetadata({ orientation: 6 }).withExifMerge(CAMERA_EXIF);
  return { name, bytes: new Uint8Array(await image.toBuffer()) };
}

export async function metadataPngFixture(name = "skjermbilde.png"): Promise<Fixture> {
  const image = (await picture(600, 400, "#e4ebef")).png().withMetadata({ orientation: 6 }).withExifMerge(CAMERA_EXIF);
  return { name, bytes: new Uint8Array(await image.toBuffer()) };
}

export async function metadataWebpFixture(name = "nettbilde.webp"): Promise<Fixture> {
  const image = (await picture(600, 400, "#f0e6e1")).webp({ quality: 80 }).withMetadata({ orientation: 6 }).withExifMerge(CAMERA_EXIF);
  return { name, bytes: new Uint8Array(await image.toBuffer()) };
}

/** Two frames, looping, with a comment block and an XMP application block added. */
export async function animatedGifFixture(name = "animasjon.gif"): Promise<Fixture> {
  const frames = await Promise.all(
    ["#1f4a3d", "#99442a"].map(async (hue) => (await picture(64, 48, hue)).png().toBuffer()),
  );
  const gif = new Uint8Array(
    await sharp(frames, { join: { animated: true } }).gif({ delay: [200, 300], loop: 0 }).toBuffer(),
  );

  const subBlocks = (value: string) => {
    const bytes = [...text(value)];
    const out: number[] = [];
    for (let i = 0; i < bytes.length; i += 255) out.push(Math.min(255, bytes.length - i), ...bytes.slice(i, i + 255));
    return [...out, 0];
  };
  // Straight after the header and the global colour table, where a writer
  // that adds metadata puts it.
  const head = 13 + (gif[10] & 0x80 ? 3 * 2 ** ((gif[10] & 0x07) + 1) : 0);
  const extra = Uint8Array.from([
    0x21, 0xfe, ...subBlocks(`${METADATA_SECRET} kommentar`),
    0x21, 0xff, 0x0b, ...text("XMP DataXMP"), ...subBlocks(`<x:xmpmeta>${METADATA_SECRET}</x:xmpmeta>`),
  ]);
  const bytes = new Uint8Array(gif.length + extra.length);
  bytes.set(gif.subarray(0, head));
  bytes.set(extra, head);
  bytes.set(gif.subarray(head), head + extra.length);
  return { name, bytes };
}

export async function animatedWebpFixture(name = "animasjon.webp"): Promise<Fixture> {
  const image = sharp(Buffer.from((await animatedGifFixture()).bytes), { animated: true }).webp().withExif(CAMERA_EXIF);
  return { name, bytes: new Uint8Array(await image.toBuffer()) };
}

function pdfString(value: string): string {
  return value.replace(/[\\()]/g, (char) => `\\${char}`).replace(/[^\x20-\x7e]/g, "?");
}

/** A valid PDF with one text page per entry, written with correct offsets. */
export function pdfFixture(name = "referat.pdf", pages = ["Referat fra styremote", "Side to", "Side tre"]): Fixture {
  const objects: string[] = [];
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((title, index) => {
    const lines = [
      "BT /F1 26 Tf 72 720 Td",
      `(${pdfString(title)}) Tj`,
      "/F1 12 Tf 0 -36 Td",
      `(TING vedleggstest - side ${index + 1} av ${pages.length}) Tj`,
      "ET",
    ].join("\n");
    objects[4 + index * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + index * 2} 0 R ` +
      "/Resources << /Font << /F1 3 0 R >> >> >>";
    objects[5 + index * 2] = `<< /Length ${lines.length} >>\nstream\n${lines}\nendstream`;
  });

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name, bytes: text(body) };
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function zip(parts: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(parts).map(([path, value]) => [path, strToU8(value)])));
}

export function docxFixture(name = "notat.docx", extraParts: Record<string, string> = {}): Fixture {
  const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const cell = (value: string) => `<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;
  return {
    name,
    bytes: zip({
      "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
      "_rels/.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      "word/_rels/document.xml.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      "word/styles.xml": `${XML}<w:styles ${w}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
      "word/document.xml": `${XML}<w:document ${w}><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Notat til lokallaget</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Dette er et avsnitt med </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>uthevet tekst</w:t></w:r><w:r><w:t xml:space="preserve"> og æøå.</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Oppgaver</w:t></w:r></w:p><w:tbl><w:tr>${cell("Oppgave")}${cell("Ansvarlig")}</w:tr><w:tr>${cell("Bestille lokale")}${cell("Kari")}</w:tr><w:tr>${cell("Sende innkalling")}${cell("Ola")}</w:tr></w:tbl><w:p><w:r><w:t>Slutt på notatet.</w:t></w:r></w:p></w:body></w:document>`,
      ...extraParts,
    }),
  };
}

/** A Word file carrying a VBA project: a .docm under another name. */
export function macroDocxFixture(name = "makro.docx"): Fixture {
  return docxFixture(name, { "word/vbaProject.bin": "not really a macro" });
}

export function xlsxFixture(name = "budsjett.xlsx"): Fixture {
  const main = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const r = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const inline = (ref: string, value: string) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const number = (ref: string, value: number) => `<c r="${ref}"><v>${value}</v></c>`;
  return {
    name,
    bytes: zip({
      "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      "_rels/.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      "xl/workbook.xml": `${XML}<workbook ${main} ${r}><sheets><sheet name="Budsjett" sheetId="1" r:id="rId1"/><sheet name="Deltakere" sheetId="2" r:id="rId2"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      "xl/styles.xml": `${XML}<styleSheet ${main}><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>`,
      "xl/worksheets/sheet1.xml": `${XML}<worksheet ${main}><sheetData><row r="1">${inline("A1", "Post")}${inline("B1", "Beløp")}</row><row r="2">${inline("A2", "Lokale")}${number("B2", 4500)}</row><row r="3">${inline("A3", "Servering")}${number("B3", 1250.5)}</row><row r="4">${inline("A4", "Sum")}<c r="B4"><f>SUM(B2:B3)</f><v>5750.5</v></c></row></sheetData></worksheet>`,
      "xl/worksheets/sheet2.xml": `${XML}<worksheet ${main}><sheetData><row r="1">${inline("A1", "Navn")}${inline("B1", "Lokallag")}</row><row r="2">${inline("A2", "Kari")}${inline("B2", "Oslo")}</row><row r="3">${inline("A3", "Ola")}${inline("B3", "Trøndelag")}</row></sheetData></worksheet>`,
    }),
  };
}

export function pptxFixture(name = "presentasjon.pptx"): Fixture {
  const ns =
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const shape = (type: string, paragraphs: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paragraphs}</p:txBody></p:sp>`;
  const para = (value: string, level = 0) =>
    `<a:p>${level ? `<a:pPr lvl="${level}"/>` : ""}<a:r><a:t>${value}</a:t></a:r></a:p>`;
  const slide = (title: string, body: string) =>
    `${XML}<p:sld ${ns}><p:cSld><p:spTree>${shape("title", para(title))}${shape("body", body)}</p:spTree></p:cSld></p:sld>`;
  return {
    name,
    bytes: zip({
      "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
      "_rels/.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
      // Deliberately listed second-first, so the order must come from here.
      "ppt/presentation.xml": `${XML}<p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>`,
      "ppt/slides/slide1.xml": slide("Veien videre", `${para("Rekruttering")}${para("Stand på campus", 1)}${para("Økonomi")}`),
      "ppt/slides/slide2.xml": slide("Årsmøte 2026", `${para("Velkommen")}${para("Dagsorden")}`),
    }),
  };
}

export function textFixture(name = "notater.txt"): Fixture {
  return { name, bytes: text("Notater fra møtet\n\n- Blåbærsyltetøy på kjøkkenet\n- <b>ikke fet</b> — markup vises som tekst\n") };
}

export function csvFixture(name = "deltakere.csv"): Fixture {
  return { name, bytes: text('Navn;Lokallag;Kommentar\nKari;Oslo;"Kommer; tar med kake"\nOla;Trøndelag;\nÅse;Vestland;"Sitat: ""ja"""\n') };
}

/** Semicolon CSV in Windows-1252, as Excel writes it on a Norwegian machine. */
export function latin1CsvFixture(name = "excel-eksport.csv"): Fixture {
  const value = "Navn;Sted\nBjørn;Tromsø\nÆsa;Ålesund\n";
  return { name, bytes: Uint8Array.from(value, (char) => char.charCodeAt(0)) };
}

/** A second of silence as 8-bit mono PCM. */
export function wavFixture(name = "lydopptak.wav"): Fixture {
  const rate = 8000;
  const samples = rate;
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  write(36, "data");
  view.setUint32(40, samples, true);
  // A quiet tone, so a player has something to show for itself.
  for (let i = 0; i < samples; i += 1) view.setUint8(44 + i, 128 + Math.round(24 * Math.sin((i / rate) * 2 * Math.PI * 440)));
  return { name, bytes: new Uint8Array(buffer) };
}

/** Enough of an MP3 to be one: an ID3v2 tag followed by MPEG audio frames. */
export function mp3Fixture(name = "opptak.mp3"): Fixture {
  const header = [0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  // MPEG-1 Layer III, 128 kbit/s, 44.1 kHz: 417-byte frames.
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  const bytes = new Uint8Array(header.length + frame.length * 4);
  bytes.set(header);
  for (let i = 0; i < 4; i += 1) bytes.set(frame, header.length + i * frame.length);
  return { name, bytes };
}

/** An MPEG-4 audio container's opening box. */
export function m4aFixture(name = "memo.m4a"): Fixture {
  const bytes = new Uint8Array(64);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 32, false);
  bytes.set(text("ftypM4A "), 4);
  view.setUint32(12, 0, false);
  bytes.set(text("M4A mp42isom"), 16);
  view.setUint32(32, 32, false);
  bytes.set(text("free"), 36);
  return { name, bytes };
}

// ── Things that must be refused ─────────────────────────────────────────

export function htmlAsTextFixture(name = "side.txt"): Fixture {
  return { name, bytes: text("<!doctype html><html><body><script>alert(1)</script></body></html>") };
}

export function svgFixture(name = "tegning.svg"): Fixture {
  return { name, bytes: text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') };
}

/** A Windows executable's header, named as a PDF. */
export function executableAsPdfFixture(name = "faktura.pdf"): Fixture {
  const bytes = new Uint8Array(256);
  bytes.set([0x4d, 0x5a, 0x90, 0x00]);
  return { name, bytes };
}

/** A plain zip archive named as a Word document. */
export function zipAsDocxFixture(name = "arkiv.docx"): Fixture {
  return { name, bytes: zip({ "readme.txt": "just a zip" }) };
}

/** An MPEG-4 video named as audio. */
export function videoAsM4aFixture(name = "film.m4a"): Fixture {
  const fixture = m4aFixture(name);
  fixture.bytes.set(text("ftypqt  "), 4);
  return fixture;
}

export function binaryAsTextFixture(name = "data.txt"): Fixture {
  return { name, bytes: Uint8Array.from([0x41, 0x00, 0x01, 0x02, 0x42, 0x00]) };
}

/** `bytes` of zeros with a text opening: a valid TXT of an exact size. */
export function sizedTextFixture(name: string, bytes: number): Fixture {
  const data = new Uint8Array(bytes).fill(0x61);
  return { name, bytes: data };
}

export async function supportedFixtures(): Promise<Fixture[]> {
  return [
    await pngFixture(),
    await jpegFixture(),
    await rotatedJpegFixture(),
    await webpFixture(),
    await gifFixture(),
    pdfFixture(),
    docxFixture(),
    xlsxFixture(),
    pptxFixture(),
    textFixture(),
    csvFixture(),
    latin1CsvFixture(),
    wavFixture(),
    mp3Fixture(),
    m4aFixture(),
  ];
}

async function writeAll(folder: string) {
  mkdirSync(folder, { recursive: true });
  const fixtures = [
    ...(await supportedFixtures()),
    await pngFixture("bilde-2.png", 900, 1200, "#e7eef2"),
    await pngFixture("bilde-3.png", 1000, 1000, "#f5e9e4"),
    htmlAsTextFixture(),
    executableAsPdfFixture(),
    sizedTextFixture("for-stor-11mb.txt", 11 * 1024 * 1024),
    sizedTextFixture("for-stor-26mb.txt", 26 * 1024 * 1024),
  ];
  for (const fixture of fixtures) writeFileSync(join(folder, fixture.name), fixture.bytes);
  console.log(`✓ ${fixtures.length} filer skrevet til ${folder}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const folder = process.argv[2];
  if (!folder) {
    console.error("Bruk: npx tsx scripts/lib/attachment-fixtures.ts <mappe>");
    process.exit(1);
  }
  void writeAll(folder);
}
