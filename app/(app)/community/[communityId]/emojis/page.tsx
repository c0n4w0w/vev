import { notFound, redirect } from "next/navigation";
import { EmojiManager } from "@/components/community/EmojiManager";
import { PageContainer, PageHeader } from "@/components/ui/primitives";
import {
  getCommunityById,
  getCommunityEmojis,
  getMembership,
  getUsers,
} from "@/lib/data";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/emojis">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  return { title: `Emojier · ${community?.name ?? "Fellesskap"}` };
}

export default async function CommunityEmojisPage({
  params,
}: PageProps<"/community/[communityId]/emojis">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();

  const [membership, emojis] = await Promise.all([
    getMembership(user.id, community.id),
    getCommunityEmojis(community.id),
  ]);

  const authors = new Map(
    (await getUsers([...new Set(emojis.map((emoji) => emoji.createdBy))])).map((u) => [u.id, u]),
  );

  const canManage = membership?.role === "admin" || membership?.role === "moderator";

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={community.name}
        title="Emojier"
        lead={`Egne emojier for ${community.name}. De finnes bare her — et annet fellesskap kan verken se dem eller bruke dem, og to fellesskap kan trygt ha hver sin :party:.`}
      />
      <EmojiManager
        communityId={community.id}
        emojis={emojis}
        authors={Object.fromEntries(authors)}
        canManage={canManage}
        accent={community.branding.accent}
      />
    </PageContainer>
  );
}
