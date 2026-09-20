import { notFound, redirect } from "next/navigation";
import { DirectConversationView } from "@/components/community/DirectConversationView";
import {
  getCommunityById,
  getDirectConversation,
  markDirectConversationRead,
} from "@/lib/data";
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

  return {
    title: `${conversation?.otherParticipant.name ?? "Samtale"} · ${community?.name ?? "Fellesskap"}`,
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
      currentUser={user}
    />
  );
}
