import { notFound, redirect } from "next/navigation";
import { ChannelView } from "@/components/community/ChannelView";
import {
  getChannel,
  getCommunityById,
  getMembership,
  getMessages,
  getUsers,
} from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import type { User } from "@/lib/types";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/channel/[channelId]">) {
  const { channelId, communityId } = await params;
  const [channel, community] = await Promise.all([
    getChannel(channelId),
    getCommunityById(communityId),
  ]);
  return {
    title: `#${channel?.name ?? "kanal"} · ${community?.name ?? "Fellesskap"}`,
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

  const [membership, messages] = await Promise.all([
    getMembership(user.id, community.id),
    getMessages(channel.id),
  ]);
  const authors = (
    await getUsers([...new Set(messages.map((message) => message.authorId))])
  ).reduce<Record<string, User>>((all, person) => ({ ...all, [person.id]: person }), {});

  return (
    <ChannelView
      key={channel.id}
      channel={channel}
      community={community}
      initialMessages={messages}
      authors={authors}
      currentUser={user}
      canPost={
        !channel.readOnly ||
        membership?.role === "admin" ||
        membership?.role === "moderator"
      }
      lastActivityLabel={
        messages.length > 0 ? timeAgo(messages[messages.length - 1].createdAt) : undefined
      }
    />
  );
}
