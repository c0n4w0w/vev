import { notFound, redirect } from "next/navigation";
import { ChannelView } from "@/components/community/ChannelView";
import {
  getChannel,
  getCommunityById,
  getCommunityEmojis,
  getCommunityPersonas,
  getMembership,
  getMessages,
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
}: PageProps<"/community/[communityId]/channel/[channelId]">) {
  const { communityId, channelId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [community, channel] = await Promise.all([
    getCommunityById(communityId),
    getChannel(channelId),
  ]);
  if (!community || !channel || channel.communityId !== community.id) notFound();

  const [membership, messages, customEmojis] = await Promise.all([
    getMembership(user.id, community.id),
    getMessages(channel.id),
    getCommunityEmojis(community.id),
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
        !channel.readOnly ||
        membership?.role === "admin" ||
        membership?.role === "moderator"
      }
      // A lokallag or team channel's name follows its group and
      // set_channel_details() refuses it, so there is nothing to offer here.
      canEdit={
        membership?.role === "admin" &&
        membership.status === "active" &&
        !channel.localGroupId &&
        !channel.subgroupId
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
