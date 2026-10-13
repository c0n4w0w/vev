/**
 * What a message attachment really is, decided from its bytes.
 *
 * The filename and the browser's declared type are claims. This reads the
 * file's own signature — and, for the zip-based Office formats, the names in
 * the archive's central directory — and returns the one supported type the
 * content is, or nothing. The extension is consulted only to tell apart things
 * that are the same bytes on the outside (plain text and CSV are both text;
 * an M4A and any other MPEG-4 file share a container), and only after the
 * content has matched the family.
 *
 * Executables, archives, HTML, SVG, video, macro-enabled Office files and
 * everything else simply do not match. The database re-checks the resulting
 * type against the same allowlist (message_attachment_extension).
 */
import { attachmentFileType, type AttachmentFileType } from "@/lib/attachment-types";

function known(mimeType: string): AttachmentFileType {
  return attachmentFileType(mimeType)!;
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * The entry names of a zip archive, from its central directory.
 *
 * Reads only the directory at the end of the file — nothing is decompressed,
 * so there is no archive bomb to trip over here. Returns undefined for
 * anything that is not a well-formed, single-disk, non-zip64 archive.
 */
function zipEntryNames(bytes: Uint8Array): string[] | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End-of-central-directory record: 22 bytes plus a comment of up to 65535.
  const earliest = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= earliest; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return undefined;

  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  let offset = view.getUint32(eocd + 16, true);
  if (count === 0 || count > 20_000 || offset + size > eocd) return undefined;

  const decoder = new TextDecoder("utf-8");
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) return undefined;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (offset + 46 + nameLength > eocd) return undefined;
    names.push(decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/** DOCX, XLSX or PPTX — by its main part, never a macro-enabled one. */
function officeType(bytes: Uint8Array, extension: string): AttachmentFileType | undefined {
  const names = zipEntryNames(bytes);
  if (!names) return undefined;
  const entries = new Set(names);
  if (!entries.has("[Content_Types].xml")) return undefined;
  // A .docx that carries a VBA project is a .docm with another name.
  if (names.some((name) => /vbaProject\.bin$/i.test(name))) return undefined;

  if (extension === "docx" && entries.has("word/document.xml")) {
    return known("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  }
  if (extension === "xlsx" && entries.has("xl/workbook.xml")) {
    return known("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }
  if (extension === "pptx" && entries.has("ppt/presentation.xml")) {
    return known("application/vnd.openxmlformats-officedocument.presentationml.presentation");
  }
  return undefined;
}

/** An MPEG audio frame header at `offset`: sync bits, a real layer, a real rate. */
function isMpegAudioFrame(bytes: Uint8Array, offset: number): boolean {
  if (bytes.length < offset + 4) return false;
  if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return false;
  const version = (bytes[offset + 1] >> 3) & 0x03;
  const layer = (bytes[offset + 1] >> 1) & 0x03;
  const bitrate = (bytes[offset + 2] >> 4) & 0x0f;
  const sampleRate = (bytes[offset + 2] >> 2) & 0x03;
  return version !== 1 && layer !== 0 && bitrate !== 0 && bitrate !== 15 && sampleRate !== 3;
}

function isMp3(bytes: Uint8Array): boolean {
  if (startsWith(bytes, [0x49, 0x44, 0x33])) {
    // ID3v2: a ten-byte header whose size is four 7-bit bytes, then audio.
    if (bytes.length < 10) return false;
    const size =
      ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    const audio = 10 + size;
    // A tag larger than what was read is still an MP3; a frame right after
    // the tag, when it is there to check, has to look like one.
    return audio >= bytes.length || isMpegAudioFrame(bytes, audio) || bytes[audio] === 0x00;
  }
  return isMpegAudioFrame(bytes, 0);
}

/** MPEG-4 brands that are audio (or the generic ones an .m4a is written with). */
const M4A_BRANDS = new Set(["M4A ", "M4B ", "mp42", "mp41", "isom", "iso2", "dash"]);

/**
 * Text: UTF-8, or UTF-16 with a byte-order mark, or a single-byte Western
 * encoding (the semicolon CSV Excel writes on a Norwegian machine is
 * Windows-1252). What it may not contain is a NUL or another control
 * character — that is a binary file — and it may not open like markup.
 */
function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;

  let text: string;
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) {
    try {
      text = new TextDecoder(bytes[0] === 0xff ? "utf-16le" : "utf-16be", { fatal: true }).decode(bytes);
    } catch {
      return false;
    }
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder("windows-1252").decode(bytes);
    }
  }

  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text)) return false;
  return !/^\s*(<!doctype|<html|<svg|<\?xml|<script)/i.test(text.slice(0, 512));
}

export function detectAttachmentFileType(
  bytes: Uint8Array,
  filename: string,
): AttachmentFileType | undefined {
  const extension = extensionOf(filename);

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return known("application/pdf"); // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return known("image/png");
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return known("image/jpeg");
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return known("image/gif"); // GIF8

  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46])) {
    // RIFF containers name their content at offset 8.
    if (startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return known("image/webp");
    if (startsWith(bytes, [0x57, 0x41, 0x56, 0x45], 8)) return known("audio/wav");
    return undefined;
  }

  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return officeType(bytes, extension);

  // MPEG-4: a box named `ftyp` first, whose major brand says what is inside.
  if (ascii(bytes, 4, 4) === "ftyp") {
    return extension === "m4a" && M4A_BRANDS.has(ascii(bytes, 8, 4)) ? known("audio/mp4") : undefined;
  }

  // MP3 has no container, so its frame sync is only trusted with the name.
  if (extension === "mp3") return isMp3(bytes) ? known("audio/mpeg") : undefined;

  if (isPlainText(bytes)) {
    if (extension === "csv") return known("text/csv");
    if (extension === "txt") return known("text/plain");
  }

  return undefined;
}

/**
 * A filename as display text: no path, no control characters, no characters a
 * path or a header could trip on, at most 200 characters, and ending in the
 * extension of the type the content turned out to be.
 */
export function cleanAttachmentName(filename: string, type: AttachmentFileType): string {
  const base = filename
    .normalize("NFC")
    .replace(/^.*[/\\]/, "")
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/[/\\]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  const ending = type.extension === "jpg" ? /\.jpe?g$/i : new RegExp(`\\.${type.extension}$`, "i");
  const stem = (ending.test(base) ? base.replace(ending, "") : base.replace(/\.[a-z0-9]{1,8}$/i, ""))
    .replace(/^\.+/, "")
    .trim();
  const suffix = `.${type.extension}`;
  const kept = Array.from(stem || "fil")
    .slice(0, 200 - suffix.length)
    .join("")
    .trim();
  return `${kept || "fil"}${suffix}`;
}
