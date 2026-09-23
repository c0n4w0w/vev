import { downloadCommunityAvatar } from "@/lib/data";
import { getSessionUser } from "@/lib/session";

/**
 * A community's profile image, for its members.
 *
 * The bucket is private, so the browser cannot fetch the object directly.
 * This handler reads it with the caller's own session and lets the database
 * decide: the storage policy only returns the object to an active member of
 * that community. Anyone else — signed out, a different community, an invited
 * but not yet active account — gets the same empty 404 that a community
 * without an image gets, so the route confirms nothing about either.
 *
 * `?v=` is the object's name and exists only to make the URL change when the
 * image does. It is not used to pick a file: the response is always the
 * community's current image, so the parameter cannot be pointed at anything.
 */
export const dynamic = "force-dynamic";

const contentTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(
  _request: Request,
  context: RouteContext<"/community/[communityId]/avatar">,
) {
  const { communityId } = await context.params;

  const user = await getSessionUser();
  if (!user) return notFound();

  const avatar = await downloadCommunityAvatar(communityId);
  if (!avatar) return notFound();

  // The type comes from the extension the path was validated to have, not from
  // whatever the stored object claims.
  const contentType = contentTypes[avatar.path.split(".").pop() ?? ""];
  if (!contentType) return notFound();

  return new Response(await avatar.blob.arrayBuffer(), {
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // Private: never stored by a shared cache. Long-lived is safe because
      // the URL carries the object's name, which changes with every upload.
      "Cache-Control": "private, max-age=604800",
    },
  });
}
