import {
  getCommunitiesForUser,
  getGroupedChannels,
  getUnreadCount,
} from "@/lib/data";
import type { Channel, ChannelGroup, Community, Membership, User } from "@/lib/types";

/**
 * Everything the navigation shell needs, resolved once per request on the
 * server and handed to the client shell as plain data.
 *
 * The whole set of the user's communities (and their channels) is included so
 * that switching between them is instant and the sidebar can derive its own
 * context from the URL. It is scoped to the signed-in user by row level
 * security — nothing here can reveal a community they are not part of.
 */
export interface ShellCommunity {
  community: Community;
  membership: Membership;
  channelGroups: { group: ChannelGroup; channels: Channel[] }[];
}

export interface ShellData {
  user: User;
  communities: ShellCommunity[];
  unreadCount: number;
}

export async function buildShellData(user: User): Promise<ShellData> {
  const [memberships, unreadCount] = await Promise.all([
    getCommunitiesForUser(user.id),
    getUnreadCount(user.id),
  ]);

  const communities = await Promise.all(
    memberships.map(async ({ community, membership }) => ({
      community,
      membership,
      channelGroups: await getGroupedChannels(community.id),
    })),
  );

  return { user, communities, unreadCount };
}
