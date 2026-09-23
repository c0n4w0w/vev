/**
 * Validation of a community profile image.
 *
 * Two layers, on purpose. `checkAvatarFileHint` runs in the browser and only
 * exists to answer quickly, before anything is uploaded; it trusts the type
 * the browser reports, so it proves nothing. `inspectCommunityAvatar` runs on
 * the server against the actual bytes and is the one that counts — the format
 * comes from magic bytes and the size from the image header, never from the
 * filename or the declared type. The bucket enforces the byte cap and the MIME
 * allowlist again below that, so a caller that skips this module still cannot
 * store an oversized or wrong-typed object.
 *
 * No cropping and no re-encoding: the image is stored as sent and displayed
 * `object-fit: cover` in a square.
 */
import { readImageHeader } from "@/lib/image-header";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
/** Enough for any sensible source photo, small enough that decoding one stays cheap. */
export const AVATAR_MAX_DIMENSION = 4096;
export const AVATAR_MIN_DIMENSION = 64;

export const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";

export type AvatarFormat = "image/png" | "image/jpeg" | "image/webp";

const extensions: Record<AvatarFormat, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const TYPE_ERROR = "Bildet må være PNG, JPEG eller WebP.";
const SIZE_ERROR = `Bildet er for stort. Maks ${AVATAR_MAX_BYTES / (1024 * 1024)} MB.`;

export type AvatarCheck =
  | { ok: true; contentType: AvatarFormat; width: number; height: number; extension: string }
  | { ok: false; error: string };

/** Browser-side, for UX only. Returns an error message, or null when it looks fine. */
export function checkAvatarFileHint(file: { type: string; size: number }): string | null {
  if (file.size === 0) return "Filen er tom.";
  if (!Object.keys(extensions).includes(file.type)) return TYPE_ERROR;
  if (file.size > AVATAR_MAX_BYTES) return SIZE_ERROR;
  return null;
}

/** Server-side. Decides from the bytes, or explains why it cannot. */
export function inspectCommunityAvatar(bytes: Uint8Array): AvatarCheck {
  if (bytes.byteLength === 0) return { ok: false, error: "Filen er tom." };
  if (bytes.byteLength > AVATAR_MAX_BYTES) return { ok: false, error: SIZE_ERROR };

  const header = readImageHeader(bytes, ["image/png", "image/jpeg", "image/webp"]);
  if (!header.ok) {
    if (header.reason === "unsupported") return { ok: false, error: TYPE_ERROR };
    if (header.reason === "incomplete") return { ok: false, error: "Bildefilen er ufullstendig." };
    return { ok: false, error: "Klarte ikke lese bildet. Prøv en annen fil." };
  }

  const { width, height } = header;
  if (width > AVATAR_MAX_DIMENSION || height > AVATAR_MAX_DIMENSION) {
    return {
      ok: false,
      error: `Bildet er ${width}×${height}. Maks ${AVATAR_MAX_DIMENSION}×${AVATAR_MAX_DIMENSION} piksler.`,
    };
  }
  if (width < AVATAR_MIN_DIMENSION || height < AVATAR_MIN_DIMENSION) {
    return { ok: false, error: `Bildet er for lite. Minst ${AVATAR_MIN_DIMENSION} piksler på hver side.` };
  }

  const contentType = header.contentType as AvatarFormat;
  return { ok: true, contentType, width, height, extension: extensions[contentType] };
}
