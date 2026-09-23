/**
 * Reads the real format and pixel dimensions of an image from its header.
 *
 * Shared by the emoji and community-avatar validators. It decides from magic
 * bytes and the container's own size fields — never from a filename or a
 * declared MIME type — and it does not decode the image, so there is no image
 * library behind it and nothing to keep patched.
 *
 * Callers pass the formats they accept. A format the file really is but the
 * caller did not allow reports as `unsupported`, the same as an unknown one.
 */
export type ImageFormat = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export type ImageHeader =
  | { ok: true; contentType: ImageFormat; width: number; height: number }
  | { ok: false; reason: "unsupported" | "incomplete" | "unreadable"; format?: ImageFormat };

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * JPEG has no fixed header: dimensions live in the first "start of frame"
 * segment, so the segments are walked until one appears.
 */
function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2; // past FF D8

  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1];

    // Fill bytes between segments.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers carry no length: TEM, RSTn, SOI, EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      // Reaching the end of the image, or entropy data, without a frame
      // header means there is no size to read.
      if (marker === 0xd9) return undefined;
      offset += 2;
      continue;
    }

    const length = view.getUint16(offset + 2, false);
    if (length < 2) return undefined;

    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (offset + 9 > bytes.byteLength) return undefined;
      return { height: view.getUint16(offset + 5, false), width: view.getUint16(offset + 7, false) };
    }

    // Start of scan: compressed data follows, and the frame header should
    // already have been seen.
    if (marker === 0xda) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

export function readImageHeader(bytes: Uint8Array, allowed: ImageFormat[]): ImageHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let contentType: ImageFormat;
  let width: number;
  let height: number;

  // PNG: 89 50 4E 47 0D 0A 1A 0A, then an IHDR chunk with 32-bit dimensions.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    contentType = "image/png";
    if (!allowed.includes(contentType)) return { ok: false, reason: "unsupported", format: contentType };
    if (bytes.byteLength < 24) return { ok: false, reason: "incomplete", format: contentType };
    width = view.getUint32(16, false);
    height = view.getUint32(20, false);

    // JPEG: FF D8 FF.
  } else if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    contentType = "image/jpeg";
    if (!allowed.includes(contentType)) return { ok: false, reason: "unsupported", format: contentType };
    const size = jpegDimensions(bytes);
    if (!size) return { ok: false, reason: "unreadable", format: contentType };
    ({ width, height } = size);

    // GIF87a / GIF89a, dimensions little-endian at offset 6.
  } else if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    contentType = "image/gif";
    if (!allowed.includes(contentType)) return { ok: false, reason: "unsupported", format: contentType };
    if (bytes.byteLength < 10) return { ok: false, reason: "incomplete", format: contentType };
    width = view.getUint16(6, true);
    height = view.getUint16(8, true);

    // RIFF....WEBP, with three possible chunk layouts.
  } else if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    contentType = "image/webp";
    if (!allowed.includes(contentType)) return { ok: false, reason: "unsupported", format: contentType };
    const chunk = String.fromCharCode(...bytes.slice(12, 16));

    if (chunk === "VP8X" && bytes.byteLength >= 30) {
      width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    } else if (chunk === "VP8L" && bytes.byteLength >= 25) {
      const bits = view.getUint32(21, true);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >> 14) & 0x3fff);
    } else if (chunk === "VP8 " && bytes.byteLength >= 30) {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else {
      return { ok: false, reason: "unreadable", format: contentType };
    }
  } else {
    return { ok: false, reason: "unsupported" };
  }

  if (!width || !height) return { ok: false, reason: "unreadable", format: contentType };
  return { ok: true, contentType, width, height };
}
