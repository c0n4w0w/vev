import Link from "next/link";
import { notFound } from "next/navigation";
import { unitLabel } from "@/components/collaboration/UnitName";
import { Wordmark } from "@/components/shell/Wordmark";
import { IconClock, IconExternal, IconMapPin, IconUsers } from "@/components/ui/icons";
import { RichText, buttonClass, cn } from "@/components/ui/primitives";
import { getPublicEvent } from "@/lib/collaboration-workspace-data";
import { formatDateParts, formatFullDate, formatTime, formatWeekday, isSameDay } from "@/lib/format";
import { translator } from "@/lib/i18n";

export async function generateMetadata({ params }: PageProps<"/arrangement/[slug]">) {
  const { slug } = await params;
  const event = await getPublicEvent(slug);
  if (!event) return { title: translator("nb")("pubevent.notFoundTitle") };
  return {
    title: event.title,
    description: event.description?.slice(0, 155),
  };
}

/**
 * A published collaboration event — the only thing about a collaboration
 * anyone can see without an account.
 *
 * It reads the published PROJECTION and nothing else, through the one
 * anonymous function (`published_event_by_slug`). That projection holds only
 * what was explicitly published — title, description, time, place, audience,
 * a link, the organisers someone chose to name and an image someone chose to
 * publish — as it was when last published. There is no path from here to
 * the private plan, its notes, the team, the conversations or the files, and
 * edits to the plan do not show here until someone updates the publication.
 */
export default async function PublicEventPage({ params }: PageProps<"/arrangement/[slug]">) {
  const { slug } = await params;
  const event = await getPublicEvent(slug);
  if (!event) notFound();
  const t = translator(event.locale);
  const locale = event.locale;
  // "torsdag 22. oktober 2026, 18.00–21.00" — with the year, since a public
  // page may be read long before or after.
  const day = `${formatDateParts(event.startsAt, locale).weekday} ${formatFullDate(event.startsAt, locale)}`;
  const when = !event.endsAt
    ? `${day}, ${formatTime(event.startsAt, locale)}`
    : isSameDay(event.startsAt, event.endsAt)
      ? `${day}, ${formatTime(event.startsAt, locale)}–${formatTime(event.endsAt, locale)}`
      : `${day}, ${formatTime(event.startsAt, locale)} – ${formatWeekday(event.endsAt, locale)} ${formatTime(event.endsAt, locale)}`;

  return (
    <main lang={locale} className="flex min-h-dvh flex-col bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center px-5 py-4 lg:px-8">
          <Link href="/">
            <Wordmark />
          </Link>
        </div>
      </header>

      <article className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 lg:px-8 lg:py-14">
        {event.hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by our own route, readable only while published
          <img
            src={`/arrangement/${event.slug}/bilde?v=${encodeURIComponent(event.updatedAt)}`}
            alt=""
            className="mb-8 aspect-[16/9] w-full rounded-[6px] border border-line bg-paper-2 object-cover"
          />
        ) : null}

        <p className="label">{t("pubevent.eyebrow")}</p>
        {event.isCancelled ? (
          <p role="status" className="mt-3 inline-flex rounded-[5px] border border-rust/30 bg-rust-soft px-3 py-1.5 text-sm font-medium text-rust">
            {t("pubevent.cancelledNote")}
          </p>
        ) : null}
        <h1
          className={cn(
            "mt-3 font-display text-[2rem] leading-[1.12] text-ink [overflow-wrap:anywhere] sm:text-[2.75rem]",
            event.isCancelled && "text-ink-2 line-through decoration-rust/50 decoration-2",
          )}
        >
          {event.title}
        </h1>

        <dl className="mt-8 grid gap-5 border-y border-line py-6 sm:grid-cols-2">
          <div className="flex gap-3">
            <IconClock size={18} className="mt-0.5 shrink-0 text-ink-3" />
            <div className="min-w-0">
              <dt className="label mb-1">{t("pubevent.when")}</dt>
              <dd className="text-[0.9375rem] text-ink first-letter:uppercase">{when}</dd>
            </div>
          </div>
          {event.location ? (
            <div className="flex gap-3">
              <IconMapPin size={18} className="mt-0.5 shrink-0 text-ink-3" />
              <div className="min-w-0">
                <dt className="label mb-1">{t("pubevent.where")}</dt>
                <dd className="text-[0.9375rem] text-ink [overflow-wrap:anywhere]">{event.location}</dd>
              </div>
            </div>
          ) : null}
          <div className="flex gap-3">
            <IconUsers size={18} className="mt-0.5 shrink-0 text-ink-3" />
            <div className="min-w-0">
              <dt className="label mb-1">{t("pubevent.for")}</dt>
              <dd className="text-[0.9375rem] text-ink">{t(`ws.events.audience.${event.audience}`)}</dd>
            </div>
          </div>
        </dl>

        {event.description ? <RichText body={event.description} className="mt-8 [overflow-wrap:anywhere]" /> : null}

        {event.registrationUrl && !event.isCancelled ? (
          <p className="mt-8">
            <a
              href={event.registrationUrl}
              rel="noopener noreferrer nofollow"
              target="_blank"
              className={cn(buttonClass({ size: "lg" }), "max-w-full")}
            >
              <span className="truncate">{t("pubevent.register")}</span>
              <IconExternal size={16} className="shrink-0" />
            </a>
          </p>
        ) : null}

        {event.organizers.length > 0 ? (
          <section className="mt-12 border-t border-line pt-6">
            <h2 className="label mb-4">{t("pubevent.organizedBy")}</h2>
            <ul className="space-y-3">
              {event.organizers.map((organizer, index) => {
                const fonts = { serif: "font-display", sans: "font-sans", mono: "font-mono" } as const;
                return (
                  <li key={index} className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "inline-flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-[6px] text-[10px] font-semibold tracking-[0.04em] text-white",
                        fonts[organizer.markStyle],
                      )}
                      style={{ backgroundColor: organizer.accent }}
                    >
                      {organizer.monogram}
                    </span>
                    <span className="min-w-0 text-[0.9375rem] text-ink [overflow-wrap:anywhere]">
                      {unitLabel(organizer)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </article>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-3xl px-5 py-6 text-[12px] text-ink-3 lg:px-8">{t("pubevent.footer")}</div>
      </footer>
    </main>
  );
}
