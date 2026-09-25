import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventRsvp } from "@/components/community/EventRsvp";
import { Avatar, Badge, PageContainer, Panel } from "@/components/ui/primitives";
import { IconArrowLeft, IconClock, IconGlobe, IconLock, IconMapPin } from "@/components/ui/icons";
import { getCommunityById, getCommunityPersona, getEvent, now } from "@/lib/data";
import { formatEventRange, timeUntil } from "@/lib/format";
import { communityLocale, communityTranslator, tn, translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/events/[eventId]">) {
  const { communityId, eventId } = await params;
  const [community, event] = await Promise.all([getCommunityById(communityId), getEvent(eventId)]);
  const t = communityTranslator(community);
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
 */
export default async function EventDetailPage({
  params,
}: PageProps<"/community/[communityId]/events/[eventId]">) {
  const { communityId, eventId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [community, event] = await Promise.all([getCommunityById(communityId), getEvent(eventId)]);
  if (!community || !event || event.communityId !== community.id) notFound();
  const locale = communityLocale(community);
  const t = translator(locale);

  const host = event.hostId ? await getCommunityPersona(community.id, event.hostId) : undefined;
  const attending = event.attendeeIds.includes(user.id);
  const accent = community.branding.accent;
  const past = Date.parse(event.endsAt) < now().getTime();

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
        <Badge tone={event.isPublic ? "fjord" : "neutral"}>
          {event.isPublic ? <IconGlobe size={11} /> : <IconLock size={11} />}
          {event.isPublic ? t("events.public") : t("events.membersOnly")}
        </Badge>
        <Badge tone="outline">
          {past ? t("events.completed") : timeUntil(event.startsAt, locale)}
        </Badge>
      </div>

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
        {past ? (
          <p className="text-[13px] text-ink-3">
            {tn(locale, "events.pastNote", event.attendeeIds.length)}
          </p>
        ) : (
          <EventRsvp
            eventId={event.id}
            communityId={community.id}
            accent={accent}
            initialAttending={attending}
            attendeeCount={event.attendeeIds.length}
            capacity={event.capacity}
          />
        )}
      </Panel>

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
