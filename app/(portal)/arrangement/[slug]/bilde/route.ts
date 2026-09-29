import { downloadPublicEventImage } from "@/lib/collaboration-workspace-data";

/**
 * A published event's image.
 *
 * The bucket is private. The object is readable — to anyone — only while a
 * PUBLISHED publication references it by its exact name (storage policy
 * `published_event_images_read`); unpublishing or replacing the image makes
 * this a 404 on the next request. Only images that were explicitly copied out
 * at publication time live in that bucket: the collaboration's own files are
 * never reachable from here.
 */
export const dynamic = "force-dynamic";

const contentTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: RouteContext<"/arrangement/[slug]/bilde">) {
  const { slug } = await context.params;
  const image = await downloadPublicEventImage(slug);
  if (!image) return notFound();
  const contentType = contentTypes[image.path.split(".").pop() ?? ""];
  if (!contentType) return notFound();

  return new Response(await image.blob.arrayBuffer(), {
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // Not cached anywhere: taking an event down takes the picture with it
      // on the very next request.
      "Cache-Control": "no-store",
    },
  });
}
