import { notFound, redirect } from "next/navigation";
import { MemberAdministration } from "@/components/community/MemberAdministration";
import { ButtonLink, EmptyState, PageContainer, PageHeader } from "@/components/ui/primitives";
import {
  getCommunityById,
  getCommunityMembers,
  getMemberDmActions,
  getMembership,
} from "@/lib/data";
import { communityLocale, communityTranslator, translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/admin/members">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  const t = communityTranslator(community);
  return {
    title: t("admin.members.metaTitle", {
      name: community?.name ?? t("common.communityFallback"),
    }),
  };
}

export default async function AdminMembersPage({
  params,
}: PageProps<"/community/[communityId]/admin/members">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();
  const locale = communityLocale(community);
  const t = translator(locale);

  const membership = await getMembership(user.id, community.id);
  const isAdmin = membership?.role === "admin";

  // Membership administration is the administrator's job, same as the
  // access-request queue. A moderator would in any case get nothing back from
  // the database, but saying so plainly beats an empty page that looks broken.
  if (!isAdmin) {
    return (
      <PageContainer width="narrow">
        <PageHeader eyebrow={t("admin.eyebrow")} title={t("members.title")} />
        <EmptyState
          title={t("common.adminsOnly")}
          body={t("admin.members.adminsOnly", { name: community.name })}
        />
      </PageContainer>
    );
  }

  const [members, dmActions] = await Promise.all([
    getCommunityMembers(community.id),
    getMemberDmActions(community.id),
  ]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("admin.eyebrow")}
        title={t("members.title")}
        lead={t("admin.members.lead")}
        action={
          <ButtonLink href={`/community/${community.id}/requests`} size="sm" variant="secondary">
            {t("members.requestsButton")}
          </ButtonLink>
        }
      />
      <MemberAdministration
        members={members}
        userId={user.id}
        communityId={community.id}
        dmActions={dmActions}
        locale={locale}
      />
    </PageContainer>
  );
}
