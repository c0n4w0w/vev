import { notFound, redirect } from "next/navigation";
import { ChannelView } from "@/components/community/ChannelView";
import {
  canCreatePrivateChannel,
  canManagePrivateChannel,
  getChannel,
  getCommunityById,
  getCommunityEmojis,
  getCommunityPersonas,
  getLocalGroups,
  getMembership,
  getMessages,
  getPrivateChannelRoster,
} from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { communityLocale, communityTranslator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/channel/[channelId]">) {
  const { channelId, communityId } = await params;
  const [channel, community] = await Promise.all([
    getChannel(channelId),
    getCommunityById(communityId),
  ]);
  const t = communityTranslator(community);
  return {
    title: `#${channel?.name ?? t("channel.fallbackName")} · ${community?.name ?? t("common.communityFallback")}`,
  };
}

export default async function ChannelPage({
  params,
  searchParams,
}: PageProps<"/community/[communityId]/channel/[channelId]">) {
  const { communityId, channelId } = await params;
  const { ny } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [community, channel] = await Promise.all([
    getCommunityById(communityId),
    getChannel(channelId),
  ]);
  // `channels_select` decides whether the channel exists for this viewer. A
  // private channel someone was never in — or was removed from — is the same
  // not-found as an id that was never a channel: no name, no description.
  if (!community || !channel || channel.communityId !== community.id) notFound();

  const [membership, messages, customEmojis] = await Promise.all([
    getMembership(user.id, community.id),
    getMessages(channel.id),
    getCommunityEmojis(community.id),
  ]);

  // Lokallag channels only: the main chat may offer "+ Ny privat kanal", a
  // private channel may offer "Administrer kanal". Each answer comes from the
  // database for this viewer. The participant list of a private channel is
  // for everyone who can read it — which this viewer can, or the channel
  // would not have been found above.
  const localGroup = channel.localGroupId
    ? (await getLocalGroups(community.id)).find((group) => group.id === channel.localGroupId)
    : undefined;
  const canManage = channel.isPrivate ? await canManagePrivateChannel(channel.id) : false;
  const [canCreate, roster] = await Promise.all([
    localGroup && !channel.isPrivate ? canCreatePrivateChannel(localGroup.id) : false,
    channel.isPrivate ? getPrivateChannelRoster(community.id, channel.id) : [],
  ]);
  const personas = await getCommunityPersonas(community.id, [
    ...new Set([user.id, ...messages.map((message) => message.authorId)]),
  ]);
  const authors = Object.fromEntries(personas);

  return (
    <ChannelView
      key={channel.id}
      channel={channel}
      community={community}
      initialMessages={messages}
      authors={authors}
      currentUser={personas.get(user.id)!}
      canPost={
        !channel.archived &&
        (!channel.readOnly ||
          membership?.role === "admin" ||
          membership?.role === "moderator")
      }
      // A main lokallag or team channel's name follows its group and
      // set_channel_details() refuses it, so there is nothing to offer there.
      // A private lokallag channel is edited by whoever manages it.
      canEdit={
        channel.isPrivate
          ? canManage
          : membership?.role === "admin" &&
            membership.status === "active" &&
            !channel.localGroupId &&
            !channel.subgroupId
      }
      privateChannels={
        localGroup
          ? {
              localGroup: { id: localGroup.id, name: localGroup.name },
              canCreate,
              createRequested: canCreate && ny === "privat",
              canManage,
              roster,
              viewerIsAdmin: membership?.role === "admin" && membership.status === "active",
            }
          : undefined
      }
      customEmojis={customEmojis}
      lastActivityLabel={
        messages.length > 0
          ? timeAgo(messages[messages.length - 1].createdAt, communityLocale(community))
          : undefined
      }
    />
  );
}
