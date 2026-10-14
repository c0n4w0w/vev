import { notFound, redirect } from "next/navigation";
import { ChannelAdministration } from "@/components/community/channels/ChannelAdministration";
import { EmptyState, PageContainer, PageHeader } from "@/components/ui/primitives";
import {
  getChannelSections,
  getChannels,
  getCommunityById,
  getCommunityChannelContentCounts,
  getMembership,
} from "@/lib/data";
import { isCommunityChannel } from "@/lib/channel-management-form";
import { communityLocale, communityTranslator, translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/kanaler">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  const t = communityTranslator(community);
  return { title: t("channels.admin.metaTitle", { name: community?.name ?? t("common.communityFallback") }) };
}

/**
 * Administrasjon → Kanaler: the community's own channels and sections, for its
 * active administrators. A community may have none of either; this page is
 * where its administrators decide what it has.
 *
 * Lokallag chats, private lokallag channels and group chats are not here: they
 * belong to their lokallag or group and are managed there. Which rows appear
 * is RLS's answer for this viewer, and every action on the page goes through
 * a database function that checks again that the caller administers the
 * community — the admin check below only decides what to draw.
 */
export default async function ChannelAdministrationPage({
  params,
  searchParams,
}: PageProps<"/community/[communityId]/kanaler">) {
  const { communityId } = await params;
  const { ny } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();
  const t = translator(communityLocale(community));

  const membership = await getMembership(user.id, community.id);
  if (membership?.role !== "admin" || membership.status !== "active") {
    return (
      <PageContainer width="narrow">
        <PageHeader eyebrow={t("admin.eyebrow")} title={t("channels.admin.title")} />
        <EmptyState
          title={t("channels.admin.notAdminTitle")}
          body={t("channels.admin.notAdminBody", { community: community.name })}
        />
      </PageContainer>
    );
  }

  const [sections, allChannels] = await Promise.all([getChannelSections(community.id), getChannels(community.id)]);
  const channels = allChannels.filter(isCommunityChannel);
  const counts = Object.fromEntries(
    await Promise.all(
      channels.map(async (channel) => [channel.id, await getCommunityChannelContentCounts(channel.id)] as const),
    ),
  );

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={t("admin.eyebrow")}
        title={t("channels.admin.title")}
        lead={t("channels.admin.lead", { community: community.name })}
      />
      <ChannelAdministration
        communityId={community.id}
        communityName={community.name}
        accent={community.branding.accent}
        sections={sections}
        channels={channels}
        counts={counts}
        createRequested={ny === "kanal"}
      />
    </PageContainer>
  );
}
