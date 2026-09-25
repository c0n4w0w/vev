import { downloadMemberAvatar } from "@/lib/data";
import { getSessionUser } from "@/lib/session";

/**
 * One member's profile photo in one community.
 *
 * Same shape as the community image route next door. The bucket is private,
 * so this reads the object with the caller's own session and lets the
 * database decide: the profile row is only visible through
 * `can_view_community_profile`, and the object only through the matching
 * storage policy. Signed out, another community, a profile you have no reason
 * to see, no photo at all — every one of them is the same empty 404.
 *
 * `?v=` only changes the URL when the photo changes. It never selects a file:
 * the response is always the photo the profile currently uses.
 */
export const dynamic = "force-dynamic";

const contentTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(
  _request: Request,
  context: RouteContext<"/community/[communityId]/member-avatar/[userId]">,
) {
  const { communityId, userId } = await context.params;
  if (!UUID.test(userId)) return notFound();

  const user = await getSessionUser();
  if (!user) return notFound();

  const avatar = await downloadMemberAvatar(communityId, userId);
  if (!avatar) return notFound();

  const contentType = contentTypes[avatar.path.split(".").pop() ?? ""];
  if (!contentType) return notFound();

  return new Response(await avatar.blob.arrayBuffer(), {
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=604800",
    },
  });
}
