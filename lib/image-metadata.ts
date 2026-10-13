/**
 * Removes metadata from an image without touching its pixels.
 *
 * A photo straight from a phone says where it was taken, on what, and when —
 * EXIF with GPS coordinates, XMP, IPTC, a maker's notes, sometimes a whole
 * second image or a video appended after the end. None of that is the
 * picture, and in a private conversation about sensitive things it is the
 * part most likely to hurt someone. So every image attached to a message has
 * it taken out before the file is stored; the stored file is the only one
 * there is, which makes "download original" the cleaned file too.
 *
 * It is done by rewriting the container, not by re-encoding: the compressed
 * image data is copied byte for byte, so nothing is recompressed, no quality
 * is lost, and an animation keeps every frame and its timing. What is kept is
 * what a decoder needs to show the picture correctly — the colour profile,
 * transparency, animation control — and one thing from EXIF: the orientation.
 * Without it a portrait photo would turn on its side, so a new, minimal EXIF
 * block carrying only that one tag is written in place of the original.
 *
 * Everything else goes, including anything this code does not recognise: the
 * lists below say what stays, not what leaves. Trailing bytes after the
 * image's own end marker are dropped as well.
 *
 * Each function returns `undefined` for a file whose structure it cannot
 * follow. The caller then falls back to re-encoding, and refuses the upload
 * if that fails too — an image is never stored with its metadata because it
 * was awkward to parse.
 */

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * The orientation tag (0x0112) of a TIFF/EXIF block, 1–8, or 1 when there is
 * none or the block cannot be read.
 */
function readOrientation(tiff: Uint8Array): number {
  if (tiff.length < 14) return 1;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return 1;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (view.getUint16(2, little) !== 42) return 1;

  const ifd = view.getUint32(4, little);
  if (ifd + 2 > tiff.length) return 1;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return 1;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** A TIFF block holding the orientation tag and nothing else. */
function orientationTiff(orientation: number): Uint8Array {
  return Uint8Array.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF, first IFD at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation, SHORT ×1
    0x00, 0x00, 0x00, 0x00, // no further IFD
  ]);
}

// ── JPEG ────────────────────────────────────────────────────────────────

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

/** Application segments a decoder needs: JFIF, the ICC profile, Adobe's colour transform. */
function keepJpegApplicationSegment(marker: number, segment: Uint8Array): boolean {
  if (marker === 0xe0) return ascii(segment, 4, 4) === "JFIF" || ascii(segment, 4, 4) === "JFXX";
  if (marker === 0xe2) return ascii(segment, 4, 11) === "ICC_PROFILE";
  if (marker === 0xee) return ascii(segment, 4, 5) === "Adobe";
  return false;
}

export function stripJpegMetadata(bytes: Uint8Array): Uint8Array | undefined {
  const length = bytes.length;
  if (length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;

  const leading: Uint8Array[] = []; // JFIF, kept directly after the start marker
  const rest: Uint8Array[] = [];
  let orientation = 1;
  let offset = 2;
  let ended = false;

  while (offset + 1 < length) {
    if (bytes[offset] !== 0xff) return undefined;
    // Fill bytes before a marker.
    while (offset + 1 < length && bytes[offset + 1] === 0xff) offset += 1;
    const marker = bytes[offset + 1];
    if (marker === undefined) return undefined;

    if (marker === 0xd9) {
      rest.push(Uint8Array.from([0xff, 0xd9]));
      ended = true;
      break; // Whatever follows the end of the image is not the image.
    }
    // Markers that stand alone, without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      rest.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    if (offset + 4 > length) return undefined;
    const size = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const end = offset + 2 + size;
    if (size < 2 || end > length) return undefined;
    const segment = bytes.subarray(offset, end);

    if (marker === 0xda) {
      // Start of scan: the header, then compressed data up to the next real
      // marker. Inside the data, FF 00 is a literal FF and FF D0–D7 are
      // restart markers; anything else ends the scan.
      let i = end;
      while (i < length) {
        if (bytes[i] !== 0xff) {
          i += 1;
          continue;
        }
        const next = bytes[i + 1];
        if (next === undefined) return undefined;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) i += 2;
        else if (next === 0xff) i += 1;
        else break;
      }
      if (i >= length) return undefined;
      rest.push(bytes.subarray(offset, i));
      offset = i;
      continue;
    }

    const application = marker >= 0xe0 && marker <= 0xef;
    if (marker === 0xe1 && EXIF_HEADER.every((byte, index) => segment[4 + index] === byte)) {
      if (orientation === 1) orientation = readOrientation(segment.subarray(10));
    } else if (application) {
      if (keepJpegApplicationSegment(marker, segment)) {
        (marker === 0xe0 && rest.length === 0 ? leading : rest).push(segment);
      }
    } else if (marker !== 0xfe) {
      // Tables, frame headers and the like. Comments (FE) are dropped.
      rest.push(segment);
    }
    offset = end;
  }
  if (!ended) return undefined;

  const exif: Uint8Array[] = [];
  if (orientation !== 1) {
    const tiff = orientationTiff(orientation);
    const size = 2 + EXIF_HEADER.length + tiff.length;
    exif.push(Uint8Array.from([0xff, 0xe1, size >> 8, size & 0xff, ...EXIF_HEADER]), tiff);
  }
  return concat([Uint8Array.from([0xff, 0xd8]), ...leading, ...exif, ...rest]);
}

// ── PNG ─────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Chunks that decide how the image looks or moves. Text (tEXt, zTXt, iTXt),
 * the timestamp (tIME), EXIF (eXIf) and private chunks are not among them.
 */
const PNG_KEEP = new Set([
  "IHDR", "PLTE", "IDAT", "IEND",
  "tRNS", "cHRM", "gAMA", "iCCP", "sBIT", "sRGB", "cICP", "mDCV", "cLLI",
  "bKGD", "hIST", "pHYs", "sPLT",
  "acTL", "fcTL", "fdAT", // animation (APNG)
]);

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i += 1) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)), false);
  return chunk;
}

export function stripPngMetadata(bytes: Uint8Array): Uint8Array | undefined {
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const kept: Uint8Array[] = [];
  let orientation = 1;
  let firstData = -1;
  let offset = 8;
  let ended = false;

  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset, false);
    const type = ascii(bytes, offset + 4, 4);
    const end = offset + 12 + size;
    if (end > bytes.length) return undefined;
    if (kept.length === 0 && type !== "IHDR") return undefined;

    if (type === "eXIf") {
      orientation = readOrientation(bytes.subarray(offset + 8, offset + 8 + size));
    } else if (PNG_KEEP.has(type)) {
      if (type === "IDAT" && firstData < 0) firstData = kept.length;
      kept.push(bytes.subarray(offset, end));
    }
    offset = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || firstData < 0) return undefined;

  if (orientation !== 1) kept.splice(firstData, 0, pngChunk("eXIf", orientationTiff(orientation)));
  return concat([Uint8Array.from(PNG_SIGNATURE), ...kept]);
}

// ── WebP ────────────────────────────────────────────────────────────────

/** Image data, alpha, the colour profile and animation. Not EXIF, not XMP. */
const WEBP_KEEP = new Set(["VP8X", "VP8 ", "VP8L", "ALPH", "ICCP", "ANIM", "ANMF"]);
const WEBP_FLAG_EXIF = 0x08;
const WEBP_FLAG_XMP = 0x04;

function webpChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(8 + data.length + (data.length & 1));
  for (let i = 0; i < 4; i += 1) chunk[i] = fourcc.charCodeAt(i);
  new DataView(chunk.buffer).setUint32(4, data.length, true);
  chunk.set(data, 8);
  return chunk;
}

export function stripWebpMetadata(bytes: Uint8Array): Uint8Array | undefined {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd > bytes.length || riffEnd < 20) return undefined;

  const kept: Uint8Array[] = [];
  let orientation = 1;
  let extended = false;
  let offset = 12;
  let first = true;

  while (offset + 8 <= riffEnd) {
    const fourcc = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const dataEnd = offset + 8 + size;
    if (dataEnd > riffEnd) return undefined;
    const end = Math.min(dataEnd + (size & 1), riffEnd);

    if (first) {
      extended = fourcc === "VP8X";
      // The simple format is one image chunk and has nowhere to put metadata.
      if (!extended && fourcc !== "VP8 " && fourcc !== "VP8L") return undefined;
      if (extended && size < 10) return undefined;
      first = false;
    }

    if (fourcc === "EXIF") {
      let tiff = bytes.subarray(offset + 8, dataEnd);
      if (EXIF_HEADER.every((byte, index) => tiff[index] === byte)) tiff = tiff.subarray(6);
      orientation = readOrientation(tiff);
    } else if (WEBP_KEEP.has(fourcc)) {
      // Copied, so the flags can be rewritten without touching the input.
      kept.push(webpChunk(fourcc, bytes.subarray(offset + 8, dataEnd)));
    }
    offset = end;
  }
  if (first) return undefined;

  if (extended) {
    kept[0][8] &= ~(WEBP_FLAG_EXIF | WEBP_FLAG_XMP);
    if (orientation !== 1) {
      kept[0][8] |= WEBP_FLAG_EXIF;
      kept.push(webpChunk("EXIF", orientationTiff(orientation)));
    }
  }

  const body = concat(kept);
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46]); // RIFF
  new DataView(header.buffer).setUint32(4, 4 + body.length, true);
  header.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return concat([header, body]);
}

// ── GIF ─────────────────────────────────────────────────────────────────

/** Application extensions that are part of how the image plays or is coloured. */
const GIF_KEEP_APPLICATIONS = new Set(["NETSCAPE2.0", "ANIMEXTS1.0", "ICCRGBG1012"]);

/** The offset just past a run of data sub-blocks, or -1. */
function skipGifSubBlocks(bytes: Uint8Array, start: number): number {
  let offset = start;
  while (offset < bytes.length) {
    const size = bytes[offset];
    offset += 1 + size;
    if (size === 0) return offset;
  }
  return -1;
}

/**
 * GIF has no EXIF, but it has comment blocks and application blocks, and XMP
 * can be carried in one. Frames, timing and looping are copied untouched.
 */
export function stripGifMetadata(bytes: Uint8Array): Uint8Array | undefined {
  const signature = ascii(bytes, 0, 6);
  if (bytes.length < 14 || (signature !== "GIF87a" && signature !== "GIF89a")) return undefined;

  let offset = 13;
  if (bytes[10] & 0x80) offset += 3 * 2 ** ((bytes[10] & 0x07) + 1);
  if (offset > bytes.length) return undefined;
  const kept: Uint8Array[] = [bytes.subarray(0, offset)];

  while (offset < bytes.length) {
    const block = bytes[offset];

    if (block === 0x3b) {
      kept.push(Uint8Array.from([0x3b]));
      return concat(kept);
    }

    if (block === 0x2c) {
      // Image descriptor, optional local colour table, then the image data.
      if (offset + 10 > bytes.length) return undefined;
      let end = offset + 10;
      if (bytes[offset + 9] & 0x80) end += 3 * 2 ** ((bytes[offset + 9] & 0x07) + 1);
      end = skipGifSubBlocks(bytes, end + 1);
      if (end < 0) return undefined;
      kept.push(bytes.subarray(offset, end));
      offset = end;
      continue;
    }

    if (block === 0x21) {
      const label = bytes[offset + 1];
      const end = skipGifSubBlocks(bytes, offset + 2);
      if (end < 0) return undefined;
      const keep =
        label === 0xf9 || // graphic control: delay, disposal, transparency
        label === 0x01 || // plain text, which is drawn
        (label === 0xff && bytes[offset + 2] === 11 && GIF_KEEP_APPLICATIONS.has(ascii(bytes, offset + 3, 11)));
      if (keep) kept.push(bytes.subarray(offset, end));
      offset = end;
      continue;
    }

    return undefined;
  }
  return undefined;
}

export function stripImageMetadata(bytes: Uint8Array, mimeType: string): Uint8Array | undefined {
  try {
    switch (mimeType) {
      case "image/jpeg":
        return stripJpegMetadata(bytes);
      case "image/png":
        return stripPngMetadata(bytes);
      case "image/webp":
        return stripWebpMetadata(bytes);
      case "image/gif":
        return stripGifMetadata(bytes);
      default:
        return undefined;
    }
  } catch {
    // An out-of-range read in a malformed file: not something to store as is.
    return undefined;
  }
}
