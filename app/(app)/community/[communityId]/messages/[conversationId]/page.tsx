import { getRequestTranslator } from "@/lib/i18n/server";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { DirectConversationView } from "@/components/community/DirectConversationView";
import {
  getCommunityById,
  getCommunityEmojis,
  getCommunityPersona,
  getDirectConversation,
  markDirectConversationRead,
} from "@/lib/data";
import { getAttachmentPolicy } from "@/lib/attachment-data";
import { purgeExpiredDirectMessages } from "@/lib/attachment-storage";

import { getSessionUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/messages/[conversationId]">) {
  const { communityId, conversationId } = await params;
  const user = await getSessionUser();
  const [community, conversation] = user
    ? await Promise.all([
        getCommunityById(communityId),
        getDirectConversation(conversationId, user.id),
      ])
    : [undefined, undefined];

  const t = await getRequestTranslator(community);
  return {
    title: `${conversation?.otherParticipant.name ?? t("dm.fallbackTitle")} · ${community?.name ?? t("common.communityFallback")}`,
  };
}

export default async function DirectConversationPage({
  params,
}: PageProps<"/community/[communityId]/messages/[conversationId]">) {
  const { communityId, conversationId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [community, conversation] = await Promise.all([
    getCommunityById(communityId),
    getDirectConversation(conversationId, user.id),
  ]);

  if (!community || !conversation || conversation.communityId !== community.id) notFound();

  // Read up to the newest message this page shows. A disappearing message
  // from the other participant starts its timer here, at the database's
  // clock; one written after this load has not been seen and does not.
  const shownThrough = Math.max(0, ...conversation.messages.map((message) => message.seq ?? 0));
  await markDirectConversationRead(conversation.id, shownThrough);

  // Expired messages are already unreadable; remove them and their files
  // now rather than waiting for the scheduled sweep.
  if (
    conversation.disappearSeconds ||
    conversation.notices.length > 0 ||
    conversation.messages.some((message) => message.disappearSeconds)
  ) {
    after(async () => {
      try {
        await purgeExpiredDirectMessages({ conversationIds: [conversation.id], maxBatches: 1 });
      } catch (error) {
        console.error("[messages] expiry purge after opening a conversation failed", error);
      }
    });
  }

  return (
    <DirectConversationView
      key={conversation.id}
      conversation={conversation}
      community={community}
      currentUser={await getCommunityPersona(community.id, user.id)}
      customEmojis={await getCommunityEmojis(conversation.communityId)}
      attachmentPolicy={await getAttachmentPolicy({ conversationId: conversation.id })}
    />
  );
}
