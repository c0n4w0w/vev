import { getRequestLocale, getRequestTranslator } from "@/lib/i18n/server";
import { notFound, redirect } from "next/navigation";
import { EmojiManager } from "@/components/community/EmojiManager";
import { PageContainer, PageHeader } from "@/components/ui/primitives";
import {
  getCommunityById,
  getCommunityEmojis,
  getCommunityPersonas,
  getMembership,
} from "@/lib/data";
import { translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/emojis">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  const t = await getRequestTranslator(community);
  return { title: `${t("emoji.title")} · ${community?.name ?? t("common.communityFallback")}` };
}

export default async function CommunityEmojisPage({
  params,
}: PageProps<"/community/[communityId]/emojis">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();
  const t = translator(await getRequestLocale(community));

  const [membership, emojis] = await Promise.all([
    getMembership(user.id, community.id),
    getCommunityEmojis(community.id),
  ]);

  const authors = await getCommunityPersonas(community.id, [
    ...new Set(emojis.map((emoji) => emoji.createdBy)),
  ]);

  const canManage = membership?.role === "admin" || membership?.role === "moderator";

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={community.name}
        title={t("emoji.title")}
        lead={t("emoji.lead", { name: community.name })}
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
