import { notFound, redirect } from "next/navigation";
import { MemberAdministration } from "@/components/community/MemberAdministration";
import { ButtonLink, EmptyState, PageContainer, PageHeader } from "@/components/ui/primitives";
import {
  getCommunityById,
  getCommunityMembers,
  getMemberDmActions,
  getMembership,
} from "@/lib/data";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/admin/members">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  return { title: `Medlemmer · Administrasjon · ${community?.name ?? "Fellesskap"}` };
}

export default async function AdminMembersPage({
  params,
}: PageProps<"/community/[communityId]/admin/members">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();

  const membership = await getMembership(user.id, community.id);
  const isAdmin = membership?.role === "admin";

  // Membership administration is the administrator's job, same as the
  // access-request queue. A moderator would in any case get nothing back from
  // the database, but saying so plainly beats an empty page that looks broken.
  if (!isAdmin) {
    return (
      <PageContainer width="narrow">
        <PageHeader eyebrow="Administrasjon" title="Medlemmer" />
        <EmptyState
          title="Kun for administratorer"
          body={`Det er administratorene i ${community.name} som endrer tilgang og moderatorrettigheter. Som moderator følger du opp samtaler og innhold.`}
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
        eyebrow="Administrasjon"
        title="Medlemmer"
        lead="Administrer tilgang og moderatorrettigheter i fellesskapet."
        action={
          <ButtonLink href={`/community/${community.id}/requests`} size="sm" variant="secondary">
            Medlemsforespørsler
          </ButtonLink>
        }
      />
      <MemberAdministration
        members={members}
        userId={user.id}
        communityId={community.id}
        dmActions={dmActions}
      />
    </PageContainer>
  );
}
