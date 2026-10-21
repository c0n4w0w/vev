import { getRequestLocale, getRequestTranslator } from "@/lib/i18n/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SubgroupAdmin } from "@/components/community/SubgroupAdmin";
import { SubgroupCreate } from "@/components/community/SubgroupCreate";
import { SubgroupManage } from "@/components/community/SubgroupManage";
import { Badge, EmptyState, PageContainer, PageHeader } from "@/components/ui/primitives";
import { IconArrowRight } from "@/components/ui/icons";
import {
  canCreateSubgroup,
  getChannels,
  getCommunityById,
  getManageableSubgroups,
  getMembership,
  getSubgroupContentCounts,
  getSubgroupRoster,
  searchSubgroupCandidates,
} from "@/lib/data";
import { translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/grupper">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  const t = await getRequestTranslator(community);
  return {
    title: t("subgroups.metaTitle", { name: community?.name ?? t("common.communityFallback") }),
  };
}

/**
 * Private groups the viewer may manage, and — for the community's admins and
 * moderators — the way to create one. Admins see every group, a
 * gruppeansvarlig sees the groups they manage; a moderator who manages none
 * still gets the page, for "+ Ny gruppe". Which groups appear, who is in them,
 * who may be added and what each button may do all come from the database
 * (RLS plus the manager-only functions); this page decides nothing. There is
 * no list of every member to pick from: a manager searches by name and gets
 * at most ten matches.
 *
 * Managing is not reading. The link to a group's chat appears only when
 * `channels_select` returns that channel to the viewer.
 */
export default async function SubgroupsPage({
  params,
  searchParams,
}: PageProps<"/community/[communityId]/grupper">) {
  const { communityId } = await params;
  // The member search is a plain GET form: `gruppe` says which group the
  // search is for, `sok` is the text. The database decides what comes back.
  const { gruppe, sok } = await searchParams;
  const searchFor = typeof gruppe === "string" ? gruppe : undefined;
  const query = typeof sok === "string" ? sok.trim().slice(0, 80) : "";
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();
  const t = translator(await getRequestLocale(community));

  const [subgroups, channels, canCreate, membership] = await Promise.all([
    getManageableSubgroups(community.id),
    getChannels(community.id),
    canCreateSubgroup(community.id),
    getMembership(user.id, community.id),
  ]);
  const viewerIsAdmin = membership?.role === "admin" && membership.status === "active";

  const create = canCreate ? (
    <SubgroupCreate
      communityId={community.id}
      communityName={community.name}
      accent={community.branding.accent}
    />
  ) : null;

  if (subgroups.length === 0) {
    return (
      <PageContainer width="narrow">
        <PageHeader eyebrow={t("admin.eyebrow")} title={t("subgroups.title")} action={create} />
        <EmptyState
          title={t("subgroups.none.title")}
          body={t(canCreate ? "subgroups.none.createBody" : "subgroups.none.body")}
        />
      </PageContainer>
    );
  }

  const details = await Promise.all(
    subgroups.map(async (subgroup) => {
      const [roster, candidates, content] = await Promise.all([
        getSubgroupRoster(subgroup.id),
        searchFor === subgroup.id ? searchSubgroupCandidates(subgroup.id, query) : [],
        getSubgroupContentCounts(subgroup.id),
      ]);
      return {
        subgroup,
        roster,
        candidates,
        content,
        query: searchFor === subgroup.id ? query : "",
        channel: channels.find((channel) => channel.subgroupId === subgroup.id),
      };
    }),
  );

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={t("admin.eyebrow")}
        title={t("subgroups.title")}
        lead={t("subgroups.lead", { name: community.name })}
        action={create}
      />
      {details.map(({ subgroup, roster, query, candidates, content, channel }) => (
        <section key={subgroup.id} id={`gruppe-${subgroup.id}`} className="mb-10 scroll-mt-20">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="label flex min-w-0 items-center gap-2">
              <span className="truncate">{subgroup.name}</span>
              {subgroup.active ? null : <Badge tone="outline">{t("subgroups.archivedBadge")}</Badge>}
            </h2>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              {channel ? (
                <Link
                  href={`/community/${community.id}/channel/${channel.id}`}
                  className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"
                >
                  {t("subgroups.openChat")}
                  <IconArrowRight size={12} />
                </Link>
              ) : null}
              <SubgroupManage
                communityId={community.id}
                subgroup={subgroup}
                content={content}
                accent={community.branding.accent}
              />
            </div>
          </div>
          {subgroup.description ? (
            <p className="mb-2 text-[13px] leading-relaxed text-ink-3">{subgroup.description}</p>
          ) : null}
          {subgroup.moderatorsRead ? (
            <p className="mb-2 text-[12px] leading-relaxed text-ink-3">{t("subgroups.moderatorsReadNote")}</p>
          ) : null}
          <div className="mt-4">
            <SubgroupAdmin
              communityId={community.id}
              subgroup={subgroup}
              roster={roster}
              query={query}
              candidates={candidates}
              viewerId={user.id}
              viewerIsAdmin={viewerIsAdmin}
            />
          </div>
        </section>
      ))}
    </PageContainer>
  );
}
