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
import { readImageHeader } from "@/lib/image-header";

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

/** Reads the real format and dimensions, or explains why it cannot. */
export function inspectEmojiImage(bytes: Uint8Array): EmojiImageCheck {
  if (bytes.byteLength === 0) return { ok: false, error: "Filen er tom." };
  if (bytes.byteLength > EMOJI_MAX_BYTES) {
    return { ok: false, error: `Filen er større enn ${Math.round(EMOJI_MAX_BYTES / 1024)} KB.` };
  }

  const header = readImageHeader(bytes, ["image/png", "image/gif", "image/webp"]);
  if (!header.ok) {
    if (header.reason === "incomplete") {
      return { ok: false, error: `${header.format === "image/gif" ? "GIF" : "PNG"}-filen er ufullstendig.` };
    }
    if (header.reason === "unreadable" && header.format === "image/webp") {
      return { ok: false, error: "WebP-varianten støttes ikke." };
    }
    if (header.reason === "unreadable") {
      return { ok: false, error: "Klarte ikke lese bildestørrelsen." };
    }
    return { ok: false, error: "Filen må være PNG, GIF eller WebP." };
  }

  const { width, height } = header;
  const contentType = header.contentType as EmojiFormat;

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
