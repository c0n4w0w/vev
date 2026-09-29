import { getCollaborationBySlug } from "@/lib/collaboration-data";
import { COLLABORATION_FILE_TYPES } from "@/lib/collaboration-file-type";
import { downloadCollaborationFile } from "@/lib/collaboration-workspace-data";
import { UUID } from "@/lib/collaboration-workspace-form";
import { getSessionUser } from "@/lib/session";

/**
 * One private collaboration file.
 *
 * Read with the caller's own session on every request: the metadata row must
 * be visible (effective access, not removed) and the object must pass the
 * storage policy. Signed out, another collaboration, a lapsed sponsorship, a
 * removed file, an id from elsewhere — every one is the same empty 404. There
 * is no signed or public URL behind this, and nothing is cached: access that
 * ends ends here too, on the next request.
 *
 * Images and PDFs open in the browser; everything else downloads. The
 * response is sandboxed and never sniffed, so a file cannot run as a page.
 */
export const dynamic = "force-dynamic";

const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain"]);

function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

/** The display name, with the verified type's extension if it lacks one. */
function downloadName(displayName: string, mimeType: string) {
  const extension = COLLABORATION_FILE_TYPES.find((type) => type.mimeType === mimeType)?.extension;
  if (!extension || displayName.toLowerCase().endsWith(`.${extension}`)) return displayName;
  if (extension === "jpg" && /\.jpe?g$/i.test(displayName)) return displayName;
  return `${displayName}.${extension}`;
}

function contentDisposition(kind: "inline" | "attachment", name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(request: Request, context: RouteContext<"/collaboration/[slug]/files/[fileId]">) {
  const { slug, fileId } = await context.params;
  if (!UUID.test(fileId)) return notFound();

  const user = await getSessionUser();
  if (!user) return notFound();
  const collaboration = await getCollaborationBySlug(slug);
  if (!collaboration) return notFound();

  const result = await downloadCollaborationFile(collaboration.id, fileId);
  if (!result) return notFound();

  const wantsDownload = new URL(request.url).searchParams.get("download") === "1";
  const inline = !wantsDownload && INLINE.has(result.file.mimeType);
  const type = result.file.mimeType.startsWith("text/")
    ? `${result.file.mimeType}; charset=utf-8`
    : result.file.mimeType;

  return new Response(await result.blob.arrayBuffer(), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": contentDisposition(
        inline ? "inline" : "attachment",
        downloadName(result.file.displayName, result.file.mimeType),
      ),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
