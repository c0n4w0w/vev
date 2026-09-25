import { notFound, redirect } from "next/navigation";
import { RequestQueue } from "@/components/community/RequestQueue";
import { EmptyState, PageContainer, PageHeader } from "@/components/ui/primitives";
import {
  getAccessRequestHistory,
  getAccessRequests,
  getCommunityById,
  getInvitations,
  getMembership,
} from "@/lib/data";
import { communityLocale, communityTranslator, translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/requests">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  const t = communityTranslator(community);
  return { title: `${t("requests.title")} · ${community?.name ?? t("common.communityFallback")}` };
}

export default async function AccessRequestsPage({
  params,
}: PageProps<"/community/[communityId]/requests">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();
  const t = translator(communityLocale(community));

  const membership = await getMembership(user.id, community.id);
  const isAdmin = membership?.role === "admin";

  // Membership administration is the administrator's job. A moderator would in
  // any case get an empty queue and a refusal from the database, but saying so
  // plainly beats showing them an empty page that looks broken.
  if (!isAdmin) {
    return (
      <PageContainer width="narrow">
        <PageHeader eyebrow={community.name} title={t("requests.title")} />
        <EmptyState
          title={t("common.adminsOnly")}
          body={t("requests.adminsOnly", { name: community.name })}
        />
      </PageContainer>
    );
  }

  const [requests, invitations, history] = await Promise.all([
    getAccessRequests(community.id),
    getInvitations(community.id),
    getAccessRequestHistory(community.id),
  ]);

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={community.name}
        title={t("requests.title")}
        lead={t("requests.lead", { name: community.name })}
      />
      <RequestQueue
        communityId={community.id}
        requests={requests}
        invitations={invitations}
        history={history}
        accent={community.branding.accent}
      />
    </PageContainer>
  );
}
