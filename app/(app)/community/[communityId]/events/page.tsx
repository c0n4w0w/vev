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
  getLocalGroups,
  getMembership,
  getPastCommunityEvents,
  getUpcomingCommunityEvents,
  getUsers,
} from "@/lib/data";
import { plural } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import { PUBLIC_HOST } from "@/lib/brand";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/events">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  return { title: `Arrangementer · ${community?.name ?? "Fellesskap"}` };
}

export default async function CommunityEventsPage({
  params,
}: PageProps<"/community/[communityId]/events">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();

  const [upcoming, past, membership, groups] = await Promise.all([
    getUpcomingCommunityEvents(community.id),
    getPastCommunityEvents(community.id),
    getMembership(user.id, community.id),
    getLocalGroups(community.id),
  ]);
  // Creation is an administrator's job, the same gate the membership queue
  // uses. The database refuses everyone else regardless of what is rendered.
  const isAdmin = membership?.role === "admin";
  const publicCount = upcoming.filter((event) => event.isPublic).length;
  const hosts = new Map(
    (await getUsers([...new Set([...upcoming, ...past].map((e) => e.hostId))])).map((u) => [
      u.id,
      u,
    ]),
  );

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={community.name}
        title="Arrangementer"
        lead={`${plural(upcoming.length, "kommende arrangement", "kommende arrangementer")}. ${publicCount} av dem vises også på den offentlige siden ${PUBLIC_HOST}/${community.slug}.`}
      />

      {isAdmin ? (
        <EventComposer
          communityId={community.id}
          communityName={community.name}
          accent={community.branding.accent}
          localGroups={groups.filter((group) => group.active)}
        />
      ) : null}

      {upcoming.length === 0 ? (
        <EmptyState
          title="Ingen kommende arrangementer"
          body={
            isAdmin
              ? "Møter, vakter og andre samlinger legges inn her. Opprett det første over."
              : "Møter, vakter og andre samlinger legges inn her av administratorene i fellesskapet."
          }
        />
      ) : (
        <div className="space-y-4">
          {upcoming.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              community={community}
              host={hosts.get(event.hostId)}
              attending={event.attendeeIds.includes(user.id)}
            />
          ))}
        </div>
      )}

      {past.length > 0 ? (
        <section className="mt-12">
          <SectionHeading>Tidligere</SectionHeading>
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
