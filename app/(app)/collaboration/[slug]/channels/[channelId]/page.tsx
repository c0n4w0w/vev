import { notFound } from "next/navigation";
import { ChannelSettings } from "@/components/collaboration/workspace/ChannelForms";
import {
  ChannelHeading,
  Conversation,
  type ThreadSummaryView,
} from "@/components/collaboration/workspace/Conversation";
import {
  getChannelMessages,
  getChannels,
  getThread,
  getWorkspacePeople,
  loadWorkspace,
} from "@/lib/collaboration-workspace-data";
import { UUID } from "@/lib/collaboration-workspace-form";
import { timeAgo } from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/collaboration/[slug]/channels/[channelId]">) {
  const { slug, channelId } = await params;
  const { collaboration } = await loadWorkspace(slug);
  const channel = (await getChannels(collaboration.id)).find((c) => c.id === channelId);
  return { title: channel ? `#${channel.name} · ${collaboration.name}` : collaboration.name };
}

/**
 * One channel. `?thread=<message id>` opens that message's thread — beside
 * the conversation on a wide screen, instead of it on a phone.
 *
 * The channel is looked up among THIS collaboration's channels, so a channel
 * id from elsewhere is not found here even for someone with access to both.
 */
export default async function ChannelPage({
  params,
  searchParams,
}: PageProps<"/collaboration/[slug]/channels/[channelId]">) {
  const { slug, channelId } = await params;
  const { thread: threadParam } = await searchParams;
  const { collaboration, me, manager } = await loadWorkspace(slug);
  if (!UUID.test(channelId)) notFound();

  const channel = (await getChannels(collaboration.id)).find((c) => c.id === channelId);
  if (!channel) notFound();

  const threadId = typeof threadParam === "string" && UUID.test(threadParam) ? threadParam : undefined;
  const [{ messages, threads }, people, thread] = await Promise.all([
    getChannelMessages(collaboration.id, channel.id),
    getWorkspacePeople(collaboration.id),
    threadId ? getThread(collaboration.id, channel.id, threadId) : Promise.resolve(undefined),
  ]);

  const summaries: Record<string, ThreadSummaryView> = {};
  for (const [id, summary] of Object.entries(threads)) {
    summaries[id] = {
      replyCount: summary.replyCount,
      lastReplyLabel: summary.lastReplyAt ? timeAgo(summary.lastReplyAt, collaboration.defaultLocale) : undefined,
    };
  }

  return (
    <>
      <ChannelHeading
        channel={channel}
        settings={manager ? <ChannelSettings channel={channel} slug={collaboration.slug} /> : undefined}
      />
      <Conversation
        collaborationId={collaboration.id}
        slug={collaboration.slug}
        channel={channel}
        people={people}
        me={me}
        manager={manager}
        messages={messages}
        threads={summaries}
        thread={thread}
        threadMissing={Boolean(threadId) && !thread}
      />
    </>
  );
}
