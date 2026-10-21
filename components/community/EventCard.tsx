import { getRequestLocale } from "@/lib/i18n/server";
import Link from "next/link";
import { Avatar, Badge, Panel, cn } from "@/components/ui/primitives";
import { subgroupBadgeTone } from "@/components/community/subgroupBadgeTone";
import { EventDateBlock as DateBlock } from "@/components/community/EventDateBlock";
import { CommunityAvatar } from "@/components/ui/CommunityAvatar";
import { IconClock, IconGlobe, IconLock, IconMapPin } from "@/components/ui/icons";
import { formatEventRange, formatTime, timeUntil } from "@/lib/format";
import { tn, translator, type Locale } from "@/lib/i18n";
import type { Community, CommunityEvent, CommunityPersona } from "@/lib/types";

/**
 * `compact` drops the description and host row. It is what the narrow sidebar
 * columns use, where the full card crowds itself into a wall of wrapped text.
 */
export async function EventCard({
  event,
  community,
  host,
  attending,
  showCommunity = false,
  variant = "full",
  className,
  locale: localeOverride,
}: {
  event: CommunityEvent;
  community: Community;
  host?: CommunityPersona;
  attending?: boolean;
  showCommunity?: boolean;
  variant?: "full" | "compact";
  className?: string;
  /** The language of the screen the card sits on; defaults to the community's own. */
  locale?: Locale;
}) {
  const locale = await getRequestLocale(localeOverride ?? community);
  const t = translator(locale);
  const accent = community.branding.accent;
  // A cancelled event says so instead of counting down, and nobody is
  // "attending" it any more — its RSVPs are history.
  const cancelled = Boolean(event.cancelledAt);

  if (variant === "compact") {
    return (
      <Panel as="article" className={cn("p-4", className)}>
        {showCommunity ? (
          <Link
            href={`/community/${community.id}/events`}
            className="mb-2.5 flex items-center gap-1.5 text-[11px] text-ink-3 transition-colors hover:text-ink"
          >
            <CommunityAvatar community={community} size="2xs" />
            {community.name}
          </Link>
        ) : null}

        <div className="flex gap-3">
          <DateBlock iso={event.startsAt} accent={accent} locale={locale} compact />
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[0.9375rem] leading-snug text-ink">
              <Link
                href={`/community/${event.communityId}/events/${event.id}`}
                className="transition-colors hover:text-ink-2"
              >
                {event.title}
              </Link>
            </h3>
            <p className="mt-1 text-[12px] leading-snug text-ink-2">
              {formatTime(event.startsAt, locale)}–{formatTime(event.endsAt, locale)} · {event.location}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3">
              {cancelled ? (
                <span className="font-medium text-rust">{t("events.cancelled")}</span>
              ) : (
                <span>{timeUntil(event.startsAt, locale)}</span>
              )}
              <span aria-hidden="true">·</span>
              <span>{tn(locale, "count.attending", event.attendeeCount)}</span>
              {attending && !cancelled ? (
                <span className="font-medium" style={{ color: accent }}>
                  {t("events.attendingYou")}
                </span>
              ) : null}
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel as="article" className={cn("p-5", className)}>
      <div className="flex gap-4">
        <DateBlock iso={event.startsAt} accent={accent} locale={locale} />

        <div className="min-w-0 flex-1">
          {showCommunity ? (
            <Link
              href={`/community/${community.id}/events`}
              className="mb-1.5 flex items-center gap-1.5 text-xs text-ink-3 transition-colors hover:text-ink"
            >
              <CommunityAvatar community={community} size="2xs" />
              {community.name}
            </Link>
          ) : null}

          <h3 className="font-display text-lg leading-snug text-ink">
            <Link
              href={`/community/${event.communityId}/events/${event.id}`}
              className="transition-colors hover:text-ink-2"
            >
              {event.title}
            </Link>
          </h3>

          <dl className="mt-2 space-y-1 text-[13px] text-ink-2">
            <div className="flex items-start gap-1.5">
              <dt className="sr-only">{t("events.time")}</dt>
              <IconClock size={14} className="mt-[3px] shrink-0 text-ink-3" />
              <dd className="first-letter:uppercase">
                {formatEventRange(event.startsAt, event.endsAt, locale)}
              </dd>
            </div>
            <div className="flex items-start gap-1.5">
              <dt className="sr-only">{t("events.place")}</dt>
              <IconMapPin size={14} className="mt-[3px] shrink-0 text-ink-3" />
              <dd>{event.location}</dd>
            </div>
          </dl>

          <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{event.description}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {cancelled ? <Badge tone="rust">{t("events.cancelled")}</Badge> : null}
            <Badge tone={event.isPublic ? "fjord" : subgroupBadgeTone(event.subgroupSlug, "neutral")}>
              {event.isPublic ? <IconGlobe size={11} /> : <IconLock size={11} />}
              {/* A lokallag or group event is limited to that group, so it
                  names the group rather than "members only". */}
              {event.isPublic ? t("events.public") : (event.scopeName ?? t("events.membersOnly"))}
            </Badge>
            {cancelled ? null : <Badge tone="outline">{timeUntil(event.startsAt, locale)}</Badge>}
            {attending && !cancelled ? <Badge tone="skog">{t("events.attendingYou")}</Badge> : null}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
            <div className="flex items-center gap-2 text-xs text-ink-3">
              {host ? <Avatar user={host} size="xs" /> : null}
              <span>{host ? t("events.host", { name: host.name }) : t("events.hostTbd")}</span>
            </div>
            <Link
              href={`/community/${event.communityId}/events/${event.id}`}
              className="text-xs text-ink-3 transition-colors hover:text-ink"
            >
              {event.capacity
                ? t("events.attendanceOf", {
                    attending: tn(locale, "count.attending", event.attendeeCount),
                    count: event.attendeeCount,
                    capacity: event.capacity,
                  })
                : tn(locale, "count.attending", event.attendeeCount)}
            </Link>
          </div>
        </div>
      </div>
    </Panel>
  );
}
