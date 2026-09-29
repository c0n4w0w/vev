import { downloadCommunityEmoji } from "@/lib/data";
import { getSessionUser } from "@/lib/session";

/**
 * A custom emoji's image, for members of its community.
 *
 * The bucket is private and stays private. This handler reads the object with
 * the caller's own session, so the database decides: the row and the object
 * are each readable only by an active member of the emoji's community. The
 * address is stable — nothing in it expires — which is what lets a chat left
 * open for hours keep showing emojis.
 *
 * Signed out, not a member, an id from a different community, a deleted emoji
 * and an id that never existed all get the same empty 404, so the route
 * confirms nothing about whether an emoji exists elsewhere.
 */
export const dynamic = "force-dynamic";

function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(
  _request: Request,
  context: RouteContext<"/community/[communityId]/emoji/[emojiId]">,
) {
  const { communityId, emojiId } = await context.params;

  const user = await getSessionUser();
  if (!user) return notFound();

  const emoji = await downloadCommunityEmoji(communityId, emojiId);
  if (!emoji) return notFound();

  return new Response(await emoji.blob.arrayBuffer(), {
    headers: {
      // The column is constrained to png, gif and webp.
      "Content-Type": emoji.contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // Private: never in a shared cache. An emoji's file is written once and
      // never replaced (no update policy), so a day is safe; a deleted emoji
      // is no longer offered or resolved, so a stale copy is never shown.
      "Cache-Control": "private, no-store",
    },
  });
}
