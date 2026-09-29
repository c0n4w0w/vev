/**
 * What a collaboration file really is, decided from its bytes.
 *
 * The browser's declared type and the filename's extension are both just
 * claims. This reads magic bytes (and, for the zip-based office formats, the
 * container's own entry names) and returns the one allowed type the content
 * actually is — or nothing. The extension is consulted only to tell apart
 * formats that are the SAME bytes on the outside (the three OOXML formats are
 * all zip files; plain text, CSV and Markdown are all text), and only after
 * the content has matched the family.
 *
 * Executables, archives, HTML, SVG and anything else simply do not match.
 * The database and the bucket re-check the resulting type against the same
 * allowlist.
 */

export const COLLABORATION_FILE_MAX_BYTES = 8 * 1024 * 1024;

export type CollaborationFileType = {
  mimeType: string;
  extension: string;
};

const PDF: CollaborationFileType = { mimeType: "application/pdf", extension: "pdf" };
const PNG: CollaborationFileType = { mimeType: "image/png", extension: "png" };
const JPEG: CollaborationFileType = { mimeType: "image/jpeg", extension: "jpg" };
const WEBP: CollaborationFileType = { mimeType: "image/webp", extension: "webp" };
const DOCX: CollaborationFileType = {
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  extension: "docx",
};
const XLSX: CollaborationFileType = {
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  extension: "xlsx",
};
const PPTX: CollaborationFileType = {
  mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  extension: "pptx",
};
const ODF: Record<string, CollaborationFileType> = {
  "application/vnd.oasis.opendocument.text": {
    mimeType: "application/vnd.oasis.opendocument.text",
    extension: "odt",
  },
  "application/vnd.oasis.opendocument.spreadsheet": {
    mimeType: "application/vnd.oasis.opendocument.spreadsheet",
    extension: "ods",
  },
  "application/vnd.oasis.opendocument.presentation": {
    mimeType: "application/vnd.oasis.opendocument.presentation",
    extension: "odp",
  },
};
const TEXT: CollaborationFileType = { mimeType: "text/plain", extension: "txt" };
const CSV: CollaborationFileType = { mimeType: "text/csv", extension: "csv" };
const MARKDOWN: CollaborationFileType = { mimeType: "text/markdown", extension: "md" };

/** Every type a collaboration file may have, by extension. */
export const COLLABORATION_FILE_TYPES: readonly CollaborationFileType[] = [
  PDF, PNG, JPEG, WEBP, DOCX, XLSX, PPTX, ...Object.values(ODF), TEXT, CSV, MARKDOWN,
];

export const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** Whether the bytes contain an ASCII string anywhere (zip entry names). */
function contains(bytes: Uint8Array, needle: string): boolean {
  const codes = Array.from(needle, (char) => char.charCodeAt(0));
  outer: for (let i = 0; i + codes.length <= bytes.length; i += 1) {
    for (let j = 0; j < codes.length; j += 1) {
      if (bytes[i + j] !== codes[j]) continue outer;
    }
    return true;
  }
  return false;
}

function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * Text files: valid UTF-8, no NUL bytes and no other control characters
 * besides tab, line feed, carriage return and form feed.
 */
function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text)) return false;
  // HTML and SVG are text too, and a browser would run them. Refuse anything
  // that opens like markup, whatever it is called.
  return !/^\s*(<!doctype|<html|<svg|<\?xml|<script)/i.test(text.slice(0, 512));
}

export function detectCollaborationFileType(
  bytes: Uint8Array,
  filename: string,
): CollaborationFileType | undefined {
  const extension = extensionOf(filename);

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return PDF; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return JPEG;
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return WEBP; // RIFF….WEBP
  }

  // Zip containers: OOXML and OpenDocument.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // OpenDocument: the first entry is an uncompressed `mimetype` file whose
    // content names the format.
    if (ascii(bytes, 30, 8) === "mimetype") {
      const declared = ascii(bytes, 38, 60).match(/^application\/vnd\.oasis\.opendocument\.[a-z]+/)?.[0];
      const odf = declared ? ODF[declared] : undefined;
      return odf && odf.extension === extension ? odf : undefined;
    }
    // OOXML: a content-types part plus the format's own top-level folder.
    if (!contains(bytes, "[Content_Types].xml")) return undefined;
    if (extension === "docx" && contains(bytes, "word/")) return DOCX;
    if (extension === "xlsx" && contains(bytes, "xl/")) return XLSX;
    if (extension === "pptx" && contains(bytes, "ppt/")) return PPTX;
    return undefined;
  }

  if (isPlainText(bytes)) {
    if (extension === "csv") return CSV;
    if (extension === "md" || extension === "markdown") return MARKDOWN;
    if (extension === "txt" || extension === "") return TEXT;
  }

  return undefined;
}

/** "1,2 MB" / "340 kB" in the screen's language. */
export function formatFileSize(bytes: number, locale: "nb" | "en"): string {
  const tag = locale === "nb" ? "nb-NO" : "en-GB";
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(tag)} kB`;
  }
  return `${(bytes / (1024 * 1024)).toLocaleString(tag, { maximumFractionDigits: 1 })} MB`;
}
