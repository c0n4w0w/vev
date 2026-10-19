import { getChannel, getChannelPersonCard, getCommunityById } from "@/lib/data";
import { getSessionUser } from "@/lib/session";

/**
 * The profile card for a name opened in this channel, as JSON.
 *
 * Read with the caller's own session, fresh on every opening, so a person who
 * has since left — or a caller who has lost the channel — gets nothing. The
 * channel must be one the caller can read and belong to the community in the
 * address; channel_person_card answers only for someone who belongs to this
 * channel's conversation and whose identity the caller may see, with the bio
 * only where the whole profile is visible. Whether «Send melding» is offered
 * is Under The Rug's member-DM rule (can_send_dm), and only there. Anyone else
 * is the same empty 404 as an id that is no one.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const headers = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(
  _request: Request,
  context: RouteContext<"/community/[communityId]/channel/[channelId]/people/[userId]">,
) {
  const { communityId, channelId, userId } = await context.params;
  if (channelId.length > 200 || !UUID.test(userId)) return notFound();
  if (!(await getSessionUser())) return notFound();

  const [channel, community] = await Promise.all([getChannel(channelId), getCommunityById(communityId)]);
  if (!channel || !community || channel.communityId !== community.id) return notFound();

  const card = await getChannelPersonCard(community.id, channel.id, userId);
  if (!card) return notFound();

  return new Response(
    JSON.stringify({
      id: card.persona.id,
      name: card.persona.name,
      initials: card.persona.initials,
      avatarUrl: card.persona.avatarUrl ?? null,
      bio: card.bio ?? null,
      communityName: community.name,
      dm: card.dm ? { conversationId: card.dm.conversationId ?? null } : null,
    }),
    { headers },
  );
}
