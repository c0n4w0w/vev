import { getRequestLocale, getRequestTranslator } from "@/lib/i18n/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventAdminMenu } from "@/components/community/EventAdminMenu";
import { EventRosterList } from "@/components/community/EventRosterList";
import { EventRsvp } from "@/components/community/EventRsvp";
import { Avatar, Badge, PageContainer, Panel } from "@/components/ui/primitives";
import { subgroupBadgeTone } from "@/components/community/subgroupBadgeTone";
import { IconArrowLeft, IconClock, IconGlobe, IconLock, IconMapPin } from "@/components/ui/icons";
import {
  canDeleteEvent,
  canManageEvent,
  getCommunityById,
  getCommunityPersona,
  getEvent,
  getEventRoster,
  now,
} from "@/lib/data";
import { formatEventRange, timeUntil } from "@/lib/format";
import { tn, translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/events/[eventId]">) {
  const { communityId, eventId } = await params;
  const [community, event] = await Promise.all([getCommunityById(communityId), getEvent(eventId)]);
  const t = await getRequestTranslator(community);
  return {
    title: event ? t("events.detailTitle", { title: event.title }) : t("events.detailFallback"),
  };
}

/**
 * One event.
 *
 * Reached from the cards on the community's event list. Everything shown is
 * already visible to a member of the community — `events_select` returns
 * nothing to anyone else, so an event id from another community is simply not
 * found rather than refused, which is the same answer the rest of the product
 * gives about rooms you are not in.
 *
 * Who is attending is not part of that. Members see the count; the people
 * who may manage the event right now — the community's admins and, for a
 * lokallag event, its lokallagsleder — also see the roster, which is fetched
 * only for them: `getEventRoster` asks the database first and returns
 * nothing otherwise.
 *
 * The same people get one compact "Administrer" menu under the badges: edit
 * (the full editor, description included) and cancel/restore. Permanent
 * deletion appears in it for the community's admins only. All of it is
 * presentation — the database decides every write (can_manage_event;
 * deletion: admins).
 *
 * A cancelled event keeps its page: the details stay, an "Avlyst" badge and
 * notice replace the RSVP controls, and the roster stays visible to its
 * managers as history.
 */
export default async function EventDetailPage({
  params,
}: PageProps<"/community/[communityId]/events/[eventId]">) {
  const { communityId, eventId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [community, event] = await Promise.all([getCommunityById(communityId), getEvent(eventId)]);
  if (!community || !event || event.communityId !== community.id) notFound();
  const locale = await getRequestLocale(community);
  const t = translator(locale);

  const [host, roster, canManage, canDelete] = await Promise.all([
    event.hostId ? getCommunityPersona(community.id, event.hostId) : undefined,
    getEventRoster(community.id, event.id),
    canManageEvent(event.id),
    canDeleteEvent(event.id),
  ]);
  const accent = community.branding.accent;
  const past = Date.parse(event.endsAt) < now().getTime();
  const cancelled = Boolean(event.cancelledAt);
  const scopeLabel = event.isPublic
    ? t("events.public")
    : (event.scopeName ?? t("events.membersOnly"));

  return (
    <PageContainer width="narrow">
      <Link
        href={`/community/${community.id}/events`}
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-ink-2 transition-colors hover:text-ink"
      >
        <IconArrowLeft size={14} />
        {t("events.all")}
      </Link>

      <p className="label mb-2">{community.name}</p>
      <h1 className="font-display text-[1.75rem] leading-tight text-ink sm:text-[2.125rem]">
        {event.title}
      </h1>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {cancelled ? <Badge tone="rust">{t("events.cancelled")}</Badge> : null}
        <Badge tone={event.isPublic ? "fjord" : subgroupBadgeTone(event.subgroupSlug, "neutral")}>
          {event.isPublic ? <IconGlobe size={11} /> : <IconLock size={11} />}
          {/* A subgroup event names its team, as the event card does; a
              lokallag or community-wide event stays "members only". */}
          {event.isPublic
            ? t("events.public")
            : event.subgroupId && event.scopeName
              ? event.scopeName
              : t("events.membersOnly")}
        </Badge>
        {cancelled ? null : (
          <Badge tone="outline">
            {past ? t("events.completed") : timeUntil(event.startsAt, locale)}
          </Badge>
        )}
      </div>

      {canManage || canDelete ? (
        <EventAdminMenu
          communityId={community.id}
          communityName={community.name}
          event={{
            id: event.id,
            title: event.title,
            description: event.description,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            location: event.location,
            capacity: event.capacity,
            attendeeCount: event.attendeeCount,
            scopeLabel,
          }}
          cancelled={cancelled}
          ended={past}
          canManage={canManage}
          canDelete={canDelete}
          accent={accent}
        />
      ) : null}

      <dl className="mt-6 space-y-2.5 text-[0.9375rem] text-ink-2">
        <div className="flex items-start gap-2">
          <dt className="sr-only">{t("events.time")}</dt>
          <IconClock size={16} className="mt-[3px] shrink-0 text-ink-3" />
          <dd className="first-letter:uppercase">
            {formatEventRange(event.startsAt, event.endsAt, locale)}
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="sr-only">{t("events.place")}</dt>
          <IconMapPin size={16} className="mt-[3px] shrink-0 text-ink-3" />
          <dd>{event.location}</dd>
        </div>
      </dl>

      {event.description ? (
        <p className="mt-6 whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-2">
          {event.description}
        </p>
      ) : null}

      <Panel className="mt-8 p-5">
        {cancelled ? (
          <div>
            <p className="text-[0.9375rem] text-ink">{t("events.cancelledNote")}</p>
            <p className="mt-1 text-[13px] text-ink-3">{tn(locale, "count.attending", event.attendeeCount)}</p>
          </div>
        ) : past ? (
          <p className="text-[13px] text-ink-3">
            {tn(locale, "events.pastNote", event.attendeeCount)}
          </p>
        ) : (
          <EventRsvp
            eventId={event.id}
            communityId={community.id}
            accent={accent}
            initialAttending={event.attending}
            attendeeCount={event.attendeeCount}
            capacity={event.capacity}
          />
        )}
      </Panel>

      {roster ? (
        <section className="mt-6" aria-labelledby="event-roster-heading">
          <h2 id="event-roster-heading" className="label">
            {t("events.roster.heading", { count: roster.length })}
          </h2>
          {roster.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-3">{t("events.roster.empty")}</p>
          ) : (
            <EventRosterList
              communityId={community.id}
              eventId={event.id}
              attendees={roster}
              // Organisers may take someone off a scheduled, upcoming event;
              // a cancelled or past event's list is history.
              canRemove={canManage && !cancelled && !past}
            />
          )}
          <p className="mt-3 text-[12px] text-ink-3">{t("events.roster.note")}</p>
        </section>
      ) : null}

      <div className="mt-6 flex items-center gap-2.5 text-[13px] text-ink-3">
        {host ? <Avatar user={host} size="xs" /> : null}
        <span>{host ? t("events.host", { name: host.name }) : t("events.hostTbd")}</span>
      </div>

      <p className="mt-8 border-t border-line pt-4 text-[12px] leading-relaxed text-ink-3">
        {event.isPublic
          ? t("events.publicNote", { name: community.name })
          : t("events.privateNote", { name: community.name })}
      </p>
    </PageContainer>
  );
}
