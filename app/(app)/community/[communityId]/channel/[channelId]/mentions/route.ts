import { getChannel, searchMentionCandidates } from "@/lib/data";
import { getSessionUser } from "@/lib/session";

/**
 * Mention suggestions while someone types "@" in this channel, as JSON.
 *
 *   ?q=   what follows the "@", at most 40 characters
 *
 * A route rather than a server action so that each keystroke's request runs
 * on its own and can be cancelled by the next, instead of queueing behind the
 * page's other actions.
 *
 * Who may be suggested is decided by search_channel_mention_candidates for
 * the caller's own session and this channel alone: only someone who may write
 * here now gets an answer, and only with people who may be mentioned here —
 * at most 8, never the caller, never the membership list. A channel they
 * cannot read, one in another community and an archived one all answer the
 * same empty list.
 */
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const nothing = () => new Response("[]", { headers });

export async function GET(
  request: Request,
  context: RouteContext<"/community/[communityId]/channel/[channelId]/mentions">,
) {
  const { communityId, channelId } = await context.params;
  const query = new URL(request.url).searchParams.get("q") ?? "";
  if (channelId.length > 200 || query.length > 40) return nothing();

  const user = await getSessionUser();
  if (!user) return nothing();

  const channel = await getChannel(channelId);
  if (!channel || channel.communityId !== communityId) return nothing();

  return new Response(JSON.stringify(await searchMentionCandidates(communityId, channel.id, query)), { headers });
}
