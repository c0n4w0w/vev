import { notFound, redirect } from "next/navigation";
import { EventCard } from "@/components/community/EventCard";
import { EventComposer } from "@/components/community/EventComposer";
import {
  EmptyState,
  PageContainer,
  PageHeader,
  SectionHeading,
} from "@/components/ui/primitives";
import {
  getCommunityById,
  getCommunityPersonas,
  getLocalGroups,
  getSubgroups,
  getMembership,
  getCancelledCommunityEvents,
  getPastCommunityEvents,
  getUpcomingCommunityEvents,
} from "@/lib/data";
import { communityLocale, communityTranslator, tn, translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";
import { PUBLIC_HOST } from "@/lib/brand";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/events">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  const t = communityTranslator(community);
  return { title: `${t("events.title")} · ${community?.name ?? t("common.communityFallback")}` };
}

export default async function CommunityEventsPage({
  params,
}: PageProps<"/community/[communityId]/events">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();
  const locale = communityLocale(community);
  const t = translator(locale);

  const [upcoming, past, cancelled, membership, groups, subgroups] = await Promise.all([
    getUpcomingCommunityEvents(community.id),
    getPastCommunityEvents(community.id),
    getCancelledCommunityEvents(community.id),
    getMembership(user.id, community.id),
    getLocalGroups(community.id),
    getSubgroups(community.id),
  ]);
  // The full composer, with every scope, is an administrator's. A
  // lokallagsleder creates events from their own lokallag page, locked to that
  // lokallag. The database refuses everyone else regardless of what is
  // rendered.
  const isAdmin = membership?.role === "admin";
  const publicCount = upcoming.filter((event) => event.isPublic).length;
  const hosts = await getCommunityPersonas(community.id, [
    ...new Set([...upcoming, ...cancelled, ...past].map((e) => e.hostId).filter(Boolean)),
  ]);

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={community.name}
        title={t("events.title")}
        lead={t("events.lead", {
          upcoming: tn(locale, "events.upcomingCount", upcoming.length),
          public: publicCount,
          url: `${PUBLIC_HOST}/${community.slug}`,
        })}
      />

      {isAdmin ? (
        <EventComposer
          communityId={community.id}
          communityName={community.name}
          accent={community.branding.accent}
          localGroups={groups.filter((group) => group.active)}
          subgroups={subgroups.filter((subgroup) => subgroup.active)}
        />
      ) : null}

      {upcoming.length === 0 ? (
        <EmptyState
          title={t("events.empty.title")}
          body={isAdmin ? t("events.empty.admin") : t("events.empty.member")}
        />
      ) : (
        <div className="space-y-4">
          {upcoming.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              community={community}
              host={hosts.get(event.hostId)}
              attending={event.attending}
            />
          ))}
        </div>
      )}

      {/* Cancelled events are history, not "coming up": listed on their own,
          below the schedule, with the details they were announced with. */}
      {cancelled.length > 0 ? (
        <section className="mt-12">
          <SectionHeading>{t("events.cancelledSection")}</SectionHeading>
          <div className="space-y-4 opacity-80">
            {cancelled.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                community={community}
                host={hosts.get(event.hostId)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {past.length > 0 ? (
        <section className="mt-12">
          <SectionHeading>{t("events.past")}</SectionHeading>
          <div className="space-y-4 opacity-70">
            {past.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                community={community}
                host={hosts.get(event.hostId)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </PageContainer>
  );
}
