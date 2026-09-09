import { notFound, redirect } from "next/navigation";
import { RequestQueue } from "@/components/community/RequestQueue";
import { EmptyState, PageContainer, PageHeader } from "@/components/ui/primitives";
import {
  getAccessRequests,
  getCommunityById,
  getInvitations,
  getMembership,
} from "@/lib/data";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/requests">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  return { title: `Medlemsforespørsler · ${community?.name ?? "Fellesskap"}` };
}

export default async function AccessRequestsPage({
  params,
}: PageProps<"/community/[communityId]/requests">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();

  const membership = await getMembership(user.id, community.id);
  const isAdmin = membership?.role === "admin";

  // Membership administration is the administrator's job. A moderator would in
  // any case get an empty queue and a refusal from the database, but saying so
  // plainly beats showing them an empty page that looks broken.
  if (!isAdmin) {
    return (
      <PageContainer width="narrow">
        <PageHeader eyebrow={community.name} title="Medlemsforespørsler" />
        <EmptyState
          title="Kun for administratorer"
          body={`Det er administratorene i ${community.name} som tar stilling til hvem som slipper inn. Som moderator følger du opp samtaler og innhold.`}
        />
      </PageContainer>
    );
  }

  const [requests, invitations] = await Promise.all([
    getAccessRequests(community.id),
    getInvitations(community.id),
  ]);

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={community.name}
        title="Medlemsforespørsler"
        lead={`Folk som har bedt om tilgang til ${community.name} fra den offentlige siden. Godkjenner du, sender TING en invitasjon på e-post — først når den tas i bruk, blir personen medlem.`}
      />
      <RequestQueue
        communityId={community.id}
        requests={requests}
        invitations={invitations}
        accent={community.branding.accent}
      />
    </PageContainer>
  );
}
