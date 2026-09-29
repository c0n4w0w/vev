import { notFound, redirect } from "next/navigation";
import { DirectConversationView } from "@/components/community/DirectConversationView";
import {
  getCommunityById,
  getCommunityEmojis,
  getCommunityPersona,
  getDirectConversation,
  markDirectConversationRead,
} from "@/lib/data";
import { communityTranslator } from "@/lib/i18n";
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

  const t = communityTranslator(community);
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

  await markDirectConversationRead(conversation.id);

  return (
    <DirectConversationView
      key={conversation.id}
      conversation={conversation}
      community={community}
      currentUser={await getCommunityPersona(community.id, user.id)}
      customEmojis={await getCommunityEmojis(conversation.communityId)}
    />
  );
}
