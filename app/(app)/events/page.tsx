import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EventCard } from "@/components/community/EventCard";
import {
  EmptyState,
  PageContainer,
  PageHeader,
  SectionHeading,
} from "@/components/ui/primitives";
import { getCommunityById, getEventsForUser, getUsers, now } from "@/lib/data";
import { formatFullDate } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import type { CommunityEvent } from "@/lib/types";

export const metadata: Metadata = { title: "Arrangementer" };

/** Groups events by month so a long list stays readable. */
function byMonth(events: CommunityEvent[]) {
  const groups = new Map<string, CommunityEvent[]>();
  for (const event of events) {
    const date = new Date(event.startsAt);
    const key = new Intl.DateTimeFormat("nb-NO", {
      month: "long",
      year: "numeric",
      timeZone: "Europe/Oslo",
    }).format(date);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.entries()];
}

export default async function EventsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const events = await getEventsForUser(user.id);
  const attending = events.filter((event) => event.attendeeIds.includes(user.id));

  // Communities and hosts are resolved before rendering, so the cards stay
  // plain presentational components.
  const communities = new Map(
    (await Promise.all([...new Set(events.map((e) => e.communityId))].map(getCommunityById)))
      .filter((c) => Boolean(c))
      .map((c) => [c!.id, c!]),
  );
  const hosts = new Map(
    (await getUsers([...new Set(events.map((e) => e.hostId))])).map((u) => [u.id, u]),
  );

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Arrangementer"
        title="Programmet ditt"
        lead={
          events.length === 0
            ? "Her samles arrangementer fra alle fellesskapene du er med i."
            : `${events.length} kommende arrangementer på tvers av fellesskapene dine, hvorav ${attending.length} du er påmeldt.`
        }
      />

      {events.length === 0 ? (
        <EmptyState
          title="Ingen arrangementer"
          body="Når du blir med i et fellesskap, dukker møter, vakter og konserter opp her — samlet i én kalender uansett hvilken organisasjon de kommer fra."
        />
      ) : (
        <div className="space-y-10">
          {byMonth(events).map(([month, monthEvents]) => (
            <section key={month}>
              <SectionHeading>{month}</SectionHeading>
              <div className="space-y-4">
                {monthEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    community={communities.get(event.communityId)!}
                    host={hosts.get(event.hostId)}
                    attending={event.attendeeIds.includes(user.id)}
                    showCommunity
                  />
                ))}
              </div>
            </section>
          ))}
          <p className="border-t border-line pt-5 text-xs text-ink-3">
            Kalenderen viser arrangementer fra og med {formatFullDate(now().toISOString())}.
            Tidligere arrangementer ligger under det enkelte fellesskapet.
          </p>
        </div>
      )}
    </PageContainer>
  );
}
