/**
 * Server-side validation of an uploaded emoji image.
 *
 * Nothing here trusts the client. The filename is ignored entirely, and the
 * `type` the browser reports is only used as a hint — the format is decided by
 * reading the file's magic bytes, and the dimensions by parsing the actual
 * header. A PNG renamed to `.gif`, or a 4000px image declared as an emoji,
 * is rejected on what the bytes say rather than what the request claims.
 *
 * Storage enforces the size cap and the MIME allowlist as well, so a caller
 * that bypasses this module still cannot put an oversized or wrong-typed
 * object in the bucket. This exists to give a person a useful error instead of
 * an opaque storage failure, and to check dimensions, which Storage cannot.
 */
export const EMOJI_MAX_BYTES = 256 * 1024;
export const EMOJI_MAX_DIMENSION = 512;
export const EMOJI_MIN_DIMENSION = 16;

export type EmojiFormat = "image/png" | "image/gif" | "image/webp";

export type EmojiImageCheck =
  | { ok: true; contentType: EmojiFormat; width: number; height: number; extension: string }
  | { ok: false; error: string };

const extensions: Record<EmojiFormat, string> = {
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** Reads the real format and dimensions, or explains why it cannot. */
export function inspectEmojiImage(bytes: Uint8Array): EmojiImageCheck {
  if (bytes.byteLength === 0) return { ok: false, error: "Filen er tom." };
  if (bytes.byteLength > EMOJI_MAX_BYTES) {
    return { ok: false, error: `Filen er større enn ${Math.round(EMOJI_MAX_BYTES / 1024)} KB.` };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let contentType: EmojiFormat;
  let width: number;
  let height: number;

  // PNG: 89 50 4E 47 0D 0A 1A 0A, then an IHDR chunk with 32-bit dimensions.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    if (bytes.byteLength < 24) return { ok: false, error: "PNG-filen er ufullstendig." };
    contentType = "image/png";
    width = view.getUint32(16, false);
    height = view.getUint32(20, false);

    // GIF87a / GIF89a, dimensions little-endian at offset 6.
  } else if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    if (bytes.byteLength < 10) return { ok: false, error: "GIF-filen er ufullstendig." };
    contentType = "image/gif";
    width = view.getUint16(6, true);
    height = view.getUint16(8, true);

    // RIFF....WEBP, with three possible chunk layouts.
  } else if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    contentType = "image/webp";
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
      return { ok: false, error: "WebP-varianten støttes ikke." };
    }
  } else {
    return { ok: false, error: "Filen må være PNG, GIF eller WebP." };
  }

  if (!width || !height) return { ok: false, error: "Klarte ikke lese bildestørrelsen." };
  if (width > EMOJI_MAX_DIMENSION || height > EMOJI_MAX_DIMENSION) {
    return {
      ok: false,
      error: `Bildet er ${width}×${height}. Maks ${EMOJI_MAX_DIMENSION}×${EMOJI_MAX_DIMENSION} piksler.`,
    };
  }
  if (width < EMOJI_MIN_DIMENSION || height < EMOJI_MIN_DIMENSION) {
    return { ok: false, error: `Bildet er for lite. Minst ${EMOJI_MIN_DIMENSION} piksler.` };
  }

  return { ok: true, contentType, width, height, extension: extensions[contentType] };
}

/** `:Rave:` and `rave ` are the same name. Storage and lookup use this form. */
export function normalizeEmojiName(raw: string): string {
  return raw.trim().replace(/^:+|:+$/g, "").toLowerCase();
}

export function validateEmojiName(name: string): string | null {
  if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(name)) {
    return "Navnet må være 2–32 tegn: små bokstaver, tall, bindestrek eller understrek.";
  }
  return null;
}
