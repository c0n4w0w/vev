import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventRsvp } from "@/components/community/EventRsvp";
import { Avatar, Badge, PageContainer, Panel } from "@/components/ui/primitives";
import { IconArrowLeft, IconClock, IconGlobe, IconLock, IconMapPin } from "@/components/ui/icons";
import { getCommunityById, getEvent, getUsers, now } from "@/lib/data";
import { formatEventRange, timeUntil } from "@/lib/format";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: PageProps<"/community/[communityId]/events/[eventId]">) {
  const { eventId } = await params;
  const event = await getEvent(eventId);
  return { title: event ? `${event.title} · Arrangement` : "Arrangement" };
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

  const host = (await getUsers([event.hostId]))[0];
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
        Alle arrangementer
      </Link>

      <p className="label mb-2">{community.name}</p>
      <h1 className="font-display text-[1.75rem] leading-tight text-ink sm:text-[2.125rem]">
        {event.title}
      </h1>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone={event.isPublic ? "fjord" : "neutral"}>
          {event.isPublic ? <IconGlobe size={11} /> : <IconLock size={11} />}
          {event.isPublic ? "Åpent arrangement" : "Kun for medlemmer"}
        </Badge>
        <Badge tone="outline">{past ? "Gjennomført" : timeUntil(event.startsAt)}</Badge>
      </div>

      <dl className="mt-6 space-y-2.5 text-[0.9375rem] text-ink-2">
        <div className="flex items-start gap-2">
          <dt className="sr-only">Tidspunkt</dt>
          <IconClock size={16} className="mt-[3px] shrink-0 text-ink-3" />
          <dd className="first-letter:uppercase">
            {formatEventRange(event.startsAt, event.endsAt)}
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="sr-only">Sted</dt>
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
            Dette arrangementet er gjennomført.{" "}
            {event.attendeeIds.length}{" "}
            {event.attendeeIds.length === 1 ? "var påmeldt" : "var påmeldte"}.
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
        <span>{host ? `Vert: ${host.name}` : "Vert kommer"}</span>
      </div>

      <p className="mt-8 border-t border-line pt-4 text-[12px] leading-relaxed text-ink-3">
        {event.isPublic
          ? `Tid, sted og beskrivelse vises også på den offentlige siden. Hvem som er påmeldt vises kun her, for medlemmer av ${community.name}.`
          : `Dette arrangementet vises ikke utenfor ${community.name}.`}
      </p>
    </PageContainer>
  );
}
