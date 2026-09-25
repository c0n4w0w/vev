import { notFound, redirect } from "next/navigation";
import { ChannelView } from "@/components/community/ChannelView";
import {
  getChannel,
  getCommunityById,
  getCommunityPersonas,
  getMembership,
  getMessages,
} from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { getSessionUser } from "@/lib/session";

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
      lastActivityLabel={
        messages.length > 0 ? timeAgo(messages[messages.length - 1].createdAt) : undefined
      }
    />
  );
}
