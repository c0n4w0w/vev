import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SubgroupAdmin } from "@/components/community/SubgroupAdmin";
import { EmptyState, PageContainer, PageHeader, SectionHeading } from "@/components/ui/primitives";
import { IconArrowRight } from "@/components/ui/icons";
import {
  getChannels,
  getCommunityById,
  getManageableSubgroups,
  getSubgroupRoster,
  searchSubgroupCandidates,
} from "@/lib/data";
import { communityLocale, communityTranslator, translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/grupper">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  const t = communityTranslator(community);
  return {
    title: t("subgroups.metaTitle", { name: community?.name ?? t("common.communityFallback") }),
  };
}

/**
 * Private teams the viewer may manage: the community's admins see every team,
 * an explicit manager sees the teams they manage. Which teams appear, who is in
 * them and who may be added all come from the database (RLS plus the
 * manager-only roster and search functions); this page decides nothing. There
 * is no list of every member to pick from: a manager searches by name and gets
 * at most ten matches.
 *
 * Managing is not reading. The link to a team's chat appears only when
 * `channels_select` returns that channel to the viewer — a manager who is
 * neither in the team nor staff manages its members without seeing its content.
 */
export default async function SubgroupsPage({
  params,
  searchParams,
}: PageProps<"/community/[communityId]/grupper">) {
  const { communityId } = await params;
  // The member search is a plain GET form: `gruppe` says which team the
  // search is for, `sok` is the text. The database decides what comes back.
  const { gruppe, sok } = await searchParams;
  const searchFor = typeof gruppe === "string" ? gruppe : undefined;
  const query = typeof sok === "string" ? sok.trim().slice(0, 80) : "";
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();
  const t = translator(communityLocale(community));

  const [subgroups, channels] = await Promise.all([
    getManageableSubgroups(community.id),
    getChannels(community.id),
  ]);

  if (subgroups.length === 0) {
    return (
      <PageContainer width="narrow">
        <PageHeader eyebrow={t("admin.eyebrow")} title={t("subgroups.title")} />
        <EmptyState title={t("subgroups.none.title")} body={t("subgroups.none.body")} />
      </PageContainer>
    );
  }

  const details = await Promise.all(
    subgroups.map(async (subgroup) => ({
      subgroup,
      roster: await getSubgroupRoster(subgroup.id),
      query: searchFor === subgroup.id ? query : "",
      candidates: searchFor === subgroup.id ? await searchSubgroupCandidates(subgroup.id, query) : [],
      channel: channels.find((channel) => channel.subgroupId === subgroup.id),
    })),
  );

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={t("admin.eyebrow")}
        title={t("subgroups.title")}
        lead={t("subgroups.lead", { name: community.name })}
      />
      {details.map(({ subgroup, roster, query, candidates, channel }) => (
        <section key={subgroup.id} className="mb-10">
          <SectionHeading
            action={
              channel ? (
                <Link
                  href={`/community/${community.id}/channel/${channel.id}`}
                  className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"
                >
                  {t("subgroups.openChat")}
                  <IconArrowRight size={12} />
                </Link>
              ) : null
            }
          >
            {subgroup.name}
          </SectionHeading>
          {subgroup.description ? (
            <p className="-mt-2 mb-4 text-[13px] leading-relaxed text-ink-3">{subgroup.description}</p>
          ) : null}
          <SubgroupAdmin
            communityId={community.id}
            subgroup={subgroup}
            roster={roster}
            query={query}
            candidates={candidates}
          />
        </section>
      ))}
    </PageContainer>
  );
}
