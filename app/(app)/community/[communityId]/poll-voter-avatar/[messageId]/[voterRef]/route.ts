import { downloadPollVoterAvatar } from "@/lib/poll-voter-avatar";
import { getSessionUser } from "@/lib/session";

/**
 * A visible poll voter's community photo (lib/poll-voter-avatar.ts).
 *
 * Addressed by poll and opaque vote ref, never by account. Signed out, an
 * anonymous poll, a viewer who has not voted on an open poll, a channel they
 * cannot read, a voter who left, no photo — every one is the same empty 404.
 * `?v=` only changes the URL when the photo changes.
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
  context: RouteContext<"/community/[communityId]/poll-voter-avatar/[messageId]/[voterRef]">,
) {
  const { messageId, voterRef } = await context.params;
  if (!UUID.test(messageId) || !UUID.test(voterRef)) return notFound();

  const user = await getSessionUser();
  if (!user) return notFound();

  const avatar = await downloadPollVoterAvatar(user.id, messageId, voterRef);
  if (!avatar) return notFound();

  const contentType = contentTypes[avatar.path.split(".").pop() ?? ""];
  if (!contentType) return notFound();

  return new Response(await avatar.blob.arrayBuffer(), {
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // Private, and short: access ends when the viewer withdraws or leaves.
      "Cache-Control": "private, max-age=300",
    },
  });
}
