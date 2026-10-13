import "server-only";

import sharp from "sharp";

/**
 * The small rendition of an uploaded image that message lists show.
 *
 * A conversation with a dozen photos should not download a dozen originals to
 * draw a grid, and Supabase's own image transformation is not something the
 * private bucket can be read through. So the rendition is made once, here, at
 * upload: at most 640 pixels on its long side, WebP, turned the way the
 * camera meant it, with no metadata carried over — a thumbnail has no
 * location or device in it, whatever the original has.
 *
 * Decoding an image someone uploaded is the one place in the attachment path
 * that parses untrusted content on the server, so it is bounded: a hard limit
 * on decoded pixels, only the first frame of an animation, and any failure at
 * all — an image sharp cannot read, a truncated file — simply means no
 * rendition. The message then shows the original, lazily; nothing is refused
 * because a thumbnail could not be made.
 */

const LONG_SIDE = 640;
/** 64 megapixels: larger than any phone camera, far short of a decompression bomb. */
const MAX_PIXELS = 64_000_000;

export type AttachmentThumbnail = {
  bytes: Uint8Array;
  /** The original's size as a browser displays it, i.e. after EXIF rotation. */
  displayWidth: number;
  displayHeight: number;
};

export async function makeAttachmentThumbnail(
  bytes: Uint8Array,
  header: { width: number; height: number },
): Promise<AttachmentThumbnail | undefined> {
  if (header.width * header.height > MAX_PIXELS) return undefined;

  try {
    const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, animated: false, failOn: "error" });
    const { orientation } = await image.metadata();
    // EXIF orientations 5–8 are quarter turns: the stored width is the
    // displayed height.
    const turned = typeof orientation === "number" && orientation >= 5;

    const output = await image
      .rotate()
      .resize({ width: LONG_SIDE, height: LONG_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 74 })
      .toBuffer();

    return {
      bytes: new Uint8Array(output),
      displayWidth: turned ? header.height : header.width,
      displayHeight: turned ? header.width : header.height,
    };
  } catch {
    return undefined;
  }
}

/**
 * The fallback for an image whose container lib/image-metadata.ts could not
 * follow: decode it and write it out again, which carries no metadata over.
 *
 * Only reached for an unusual file — the ordinary path copies the compressed
 * data untouched. This one recompresses (at high quality), bakes the EXIF
 * rotation into the pixels since the tag itself is gone, and converts the
 * colours to sRGB as the profile goes too. An animated WebP keeps its frames.
 * `undefined` means it could not be read at all, and the upload is refused.
 */
export async function reencodeWithoutMetadata(
  bytes: Uint8Array,
  mimeType: string,
): Promise<Uint8Array | undefined> {
  try {
    const image = sharp(bytes, {
      limitInputPixels: MAX_PIXELS,
      animated: mimeType === "image/webp",
      failOn: "error",
    }).rotate();
    const output =
      mimeType === "image/jpeg"
        ? await image.jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer()
        : mimeType === "image/png"
          ? await image.png().toBuffer()
          : mimeType === "image/webp"
            ? await image.webp({ quality: 92 }).toBuffer()
            : undefined;
    return output ? new Uint8Array(output) : undefined;
  } catch {
    return undefined;
  }
}
