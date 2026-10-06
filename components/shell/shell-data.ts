import {
  getCommunitiesForUser,
  getCommunityPeople,
  getCommunityPersona,
  getGroupedChannels,
  getLocalGroups,
  getManageableSubgroups,
  getMySubgroupIds,
  getRecentDirectConversations,
  getUnreadDirectConversationCount,
  getUnreadCount,
} from "@/lib/data";
import { getVisibleCollaborations } from "@/lib/collaboration-data";
import type { Locale } from "@/lib/i18n/locales";
import type {
  Channel,
  ChannelGroup,
  Community,
  CommunityPersona,
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
  /** The signed-in person as they appear in this community. */
  me: CommunityPersona;
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
  /**
   * Whether the viewer may add and remove members of at least one subgroup —
   * a community admin, or an explicit manager. Decides only whether the
   * "Grupper" administration link is drawn; the page and the database decide
   * again per subgroup.
   */
  managesSubgroups: boolean;
  unreadDirectCount: number;
  recentDirectConversations: DirectConversationSummary[];
}

export interface ShellData {
  user: User;
  communities: ShellCommunity[];
  /**
   * Only what the shell needs to speak a collaboration's language on its own
   * pages: slug and locale of the collaborations the user is related to. A
   * collaboration is not a community and gets no sidebar of its own.
   */
  collaborations: { slug: string; defaultLocale: Locale }[];
  unreadCount: number;
}

export async function buildShellData(user: User): Promise<ShellData> {
  const [memberships, unreadCount, collaborations] = await Promise.all([
    getCommunitiesForUser(user.id),
    getUnreadCount(user.id),
    getVisibleCollaborations(),
  ]);

  const communities = await Promise.all(
    memberships.map(async ({ community, membership }) => {
      const mySubgroupIds = await getMySubgroupIds(community.id, user.id);
      const [me, channelGroups, groups, people, unreadDirectCount, recentDirectConversations, manageable] =
        await Promise.all([
          getCommunityPersona(community.id, user.id),
          getGroupedChannels(community.id, {
            localGroupId: membership.localGroupId,
            subgroupIds: mySubgroupIds,
          }),
          getLocalGroups(community.id),
          getCommunityPeople(community.id),
          getUnreadDirectConversationCount(community.id),
          getRecentDirectConversations(community.id, user.id, 5),
          getManageableSubgroups(community.id),
        ]);

      return {
        community,
        membership,
        me,
        channelGroups,
        unreadDirectCount,
        recentDirectConversations,
        hasOrganizationPeople: people.length > 0,
        managesSubgroups: manageable.length > 0,
        localGroups: {
          usesLocalGroups: groups.some((group) => group.active),
          selectedName: groups.find((group) => group.id === membership.localGroupId)?.name,
        },
      };
    }),
  );

  return {
    user,
    communities,
    collaborations: collaborations.map(({ slug, defaultLocale }) => ({ slug, defaultLocale })),
    unreadCount,
  };
}
