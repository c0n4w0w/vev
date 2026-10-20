import { after } from "next/server";
import { discardAttachment, findAttachmentFile, readAttachmentObject } from "@/lib/attachment-data";
import { purgeAttachmentObjects } from "@/lib/attachment-storage";
import { attachmentFileType } from "@/lib/attachment-types";
import { isSameOrigin } from "@/lib/same-origin";
import { getSessionUser } from "@/lib/session";

/**
 * One message attachment: its original, its thumbnail, or a download.
 *
 * This address is the only way a file leaves the private bucket. There is no
 * public URL and no signed URL behind it — a signed URL keeps working until
 * it expires, whoever holds it and whatever has happened since. Instead every
 * request, thumbnails and previews included, is read with the caller's own
 * session and decided by the database at that moment: the row must be visible
 * to them (they can read the conversation now) and the object must pass the
 * bucket's policy, which looks the row up again. Removed from a group, taken
 * out of a channel, no longer a member, a deleted message — the next request
 * is an empty 404, the same answer as an id that never existed or one from
 * another community.
 *
 *   GET            the original, inline for what a browser shows safely
 *                  (images, PDF, audio) and as a download otherwise
 *   ?variant=thumb an image's small rendition (the original if none was made)
 *   ?download=1    the original, always as a download
 *   DELETE         the uploader taking back a file they have not sent
 *
 * Whatever the file is, it cannot act as a page: the type is the one the
 * server read from the bytes at upload, sniffing is off, and the response is
 * sandboxed with no script or network of its own. Nothing is stored in a
 * shared cache. For a channel's file the browser may keep a copy but must ask
 * again before using it, and is told 304 only after the same authorisation.
 * A direct conversation's file is never stored at all: a message there may
 * disappear, and a copy on disk would outlive it.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Types a browser renders without running anything. Everything else downloads. */
const INLINE_KINDS = new Set(["image", "pdf", "audio"]);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

function contentDisposition(kind: "inline" | "attachment", name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** A single `bytes=a-b` range, or undefined for anything else. */
function parseRange(header: string | null, size: number): { start: number; end: number } | undefined {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (match[1] === "" && match[2] === "")) return undefined;

  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return undefined;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return undefined;
  return { start, end };
}

export async function GET(
  request: Request,
  context: RouteContext<"/community/[communityId]/attachments/[attachmentId]">,
) {
  const { communityId, attachmentId } = await context.params;
  if (!UUID.test(attachmentId)) return notFound();

  const user = await getSessionUser();
  if (!user) return notFound();

  const query = new URL(request.url).searchParams;
  const wantsDownload = query.get("download") === "1";
  const variant = !wantsDownload && query.get("variant") === "thumb" ? "thumb" : "original";

  const file = await findAttachmentFile(communityId, attachmentId, variant);
  if (!file) return notFound();

  const type = attachmentFileType(file.mimeType);
  const inline = !wantsDownload && (file.thumbnail || INLINE_KINDS.has(type?.kind ?? ""));
  const contentType = file.mimeType.startsWith("text/") ? `${file.mimeType}; charset=utf-8` : file.mimeType;

  // The content behind an attachment id never changes, so the id is its tag.
  const etag = `"${attachmentId}-${file.thumbnail ? "t" : "o"}"`;
  // A download, or any file in a direct conversation, is never kept. A
  // channel's file is private and revalidated on every use — the
  // revalidation is this same handler, so a cached copy is never shown to
  // someone who lost access.
  const noStore = wantsDownload || file.direct;
  const headers = new Headers({
    ...SECURITY_HEADERS,
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", file.name),
    "Cache-Control": noStore ? "private, no-store" : "private, no-cache",
    "Accept-Ranges": "bytes",
    ETag: etag,
    Vary: "Cookie",
  });

  if (!noStore && request.headers.get("if-none-match") === etag) {
    headers.delete("Content-Type");
    headers.delete("Content-Disposition");
    return new Response(null, { status: 304, headers });
  }

  const blob = await readAttachmentObject(file.path);
  if (!blob) return notFound();
  const bytes = await blob.arrayBuffer();
  const range = parseRange(request.headers.get("range"), bytes.byteLength);
  if (request.headers.has("range") && !range) {
    headers.set("Content-Range", `bytes */${bytes.byteLength}`);
    return new Response(null, { status: 416, headers });
  }
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${bytes.byteLength}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    return new Response(bytes.slice(range.start, range.end + 1), { status: 206, headers });
  }

  headers.set("Content-Length", String(bytes.byteLength));
  return new Response(bytes, { headers });
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/community/[communityId]/attachments/[attachmentId]">,
) {
  const { attachmentId } = await context.params;
  if (!UUID.test(attachmentId) || !(await isSameOrigin(request))) return notFound();

  const user = await getSessionUser();
  if (!user) return notFound();

  // The database removes it only if it is the caller's own and was never
  // sent; anything else is the same 404.
  if (!(await discardAttachment(attachmentId))) return notFound();

  after(async () => {
    try {
      await purgeAttachmentObjects();
    } catch (error) {
      // Stays queued; the next purge or the scheduled sweep removes it.
      console.error("[attachments] purge after a withdrawn upload failed", error);
    }
  });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
