import {
  getCommunitiesForUser,
  getCommunityPeople,
  getGroupedChannels,
  getLocalGroups,
  getRecentDirectConversations,
  getUnreadDirectConversationCount,
  getUnreadCount,
} from "@/lib/data";
import type {
  Channel,
  ChannelGroup,
  Community,
  DirectConversationSummary,
  Membership,
  User,
} from "@/lib/types";

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
  /**
   * Enough to label the sidebar entry, and nothing more.
   *
   * `usesLocalGroups` is what keeps the feature out of communities that never
   * adopted it — a community with no groups has no entry — without anything
   * checking a name or slug. `selectedName` is the viewer's own affiliation;
   * no one else's is carried here.
   */
  localGroups: { usesLocalGroups: boolean; selectedName?: string };
  hasOrganizationPeople: boolean;
  unreadDirectCount: number;
  recentDirectConversations: DirectConversationSummary[];
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
    memberships.map(async ({ community, membership }) => {
      const [channelGroups, groups, people, unreadDirectCount, recentDirectConversations] =
        await Promise.all([
          getGroupedChannels(community.id),
          getLocalGroups(community.id),
          getCommunityPeople(community.id),
          getUnreadDirectConversationCount(community.id),
          getRecentDirectConversations(community.id, user.id, 5),
        ]);

      return {
        community,
        membership,
        channelGroups,
        unreadDirectCount,
        recentDirectConversations,
        hasOrganizationPeople: people.length > 0,
        localGroups: {
          usesLocalGroups: groups.some((group) => group.active),
          selectedName: groups.find((group) => group.id === membership.localGroupId)?.name,
        },
      };
    }),
  );

  return { user, communities, unreadCount };
}
