import { getRequestLocale, getRequestTranslator } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EventCard } from "@/components/community/EventCard";
import {
  EmptyState,
  PageContainer,
  PageHeader,
  SectionHeading,
} from "@/components/ui/primitives";
import {
  getCommunityById,
  getEventsForUser,
  getPersonasAcrossCommunities,
  now,
  personaKey,
} from "@/lib/data";
import { formatFullDate } from "@/lib/format";
import { INTL_TAG, translator, type Locale } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";
import type { CommunityEvent } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getRequestTranslator())("shell.platform.events") };
}

/** Groups events by month so a long list stays readable. */
function byMonth(events: CommunityEvent[], locale: Locale) {
  const groups = new Map<string, CommunityEvent[]>();
  for (const event of events) {
    const date = new Date(event.startsAt);
    const key = new Intl.DateTimeFormat(INTL_TAG[locale], {
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

  const locale = await getRequestLocale();
  const t = translator(locale);
  const events = await getEventsForUser(user.id);
  const attending = events.filter((event) => event.attending);

  // Communities and hosts are resolved before rendering, so the cards stay
  // plain presentational components.
  const communities = new Map(
    (await Promise.all([...new Set(events.map((e) => e.communityId))].map(getCommunityById)))
      .filter((c) => Boolean(c))
      .map((c) => [c!.id, c!]),
  );
  // Each host as they appear in the event's own community.
  const hosts = await getPersonasAcrossCommunities(
    events.map((e) => ({ communityId: e.communityId, userId: e.hostId })),
  );

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("shell.platform.events")}
        title={t("platform.events.title")}
        lead={
          events.length === 0
            ? t("platform.events.emptyLead")
            : t("platform.events.lead", { count: events.length, attending: attending.length })
        }
      />

      {events.length === 0 ? (
        <EmptyState
          title={t("platform.events.empty")}
          body={t("platform.events.emptyBody")}
        />
      ) : (
        <div className="space-y-10">
          {byMonth(events, locale).map(([month, monthEvents]) => (
            <section key={month}>
              <SectionHeading>{month}</SectionHeading>
              <div className="space-y-4">
                {monthEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    community={communities.get(event.communityId)!}
                    host={hosts.get(personaKey(event.communityId, event.hostId))}
                    attending={event.attending}
                    showCommunity
                    locale={locale}
                  />
                ))}
              </div>
            </section>
          ))}
          <p className="border-t border-line pt-5 text-xs text-ink-3">
            {t("platform.events.since", { date: formatFullDate(now().toISOString(), locale) })}
          </p>
        </div>
      )}
    </PageContainer>
  );
}
