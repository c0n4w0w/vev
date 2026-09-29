import Link from "next/link";
import { EventForm } from "@/components/collaboration/workspace/EventForms";
import { IconCalendar, IconGlobe, IconPlus } from "@/components/ui/icons";
import { Badge, EmptyState, PageContainer, PageHeader } from "@/components/ui/primitives";
import { getEvents, getPublications, loadWorkspace } from "@/lib/collaboration-workspace-data";
import { formatEventRange, formatTime, formatWeekday } from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/collaboration/[slug]/events">) {
  const { slug } = await params;
  const { t, collaboration } = await loadWorkspace(slug);
  return { title: `${t("ws.events.title")} · ${collaboration.name}` };
}

/**
 * Event planning. Everything listed here is private to the team, including
 * events meant for the public — "open to everyone" describes who may come,
 * not who may read the plan.
 */
export default async function EventsPage({ params }: PageProps<"/collaboration/[slug]/events">) {
  const { slug } = await params;
  const { collaboration, manager, t, base } = await loadWorkspace(slug);
  const locale = collaboration.defaultLocale;
  const [events, publications] = await Promise.all([
    getEvents(collaboration.id),
    getPublications(collaboration.id),
  ]);

  return (
    <PageContainer width="default">
      <PageHeader title={t("ws.events.title")} lead={t("ws.events.lead")} />

      {manager ? (
        <details className="mb-8 rounded-[6px] border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
            <IconPlus size={16} className="text-skog" />
            {t("ws.events.new")}
          </summary>
          <div className="border-t border-line p-4">
            <EventForm collaborationId={collaboration.id} slug={collaboration.slug} />
          </div>
        </details>
      ) : (
        <p className="mb-6 text-[13px] text-ink-3">{t("ws.events.managersOnly")}</p>
      )}

      {events.length === 0 ? (
        <EmptyState title={t("ws.events.empty")} body={t("ws.events.lead")} />
      ) : (
        <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">
          {events.map((event) => {
            const publication = publications[event.id];
            return (
              <li key={event.id}>
                <Link href={`${base}/events/${event.id}`} className="flex items-start gap-3 px-4 py-4 hover:bg-paper-2/60">
                  <IconCalendar size={18} className="mt-0.5 shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9375rem] font-medium text-ink [overflow-wrap:anywhere]">{event.title}</span>
                    <span className="mt-0.5 block text-[13px] text-ink-2">
                      {event.startsAt
                        ? event.endsAt
                          ? formatEventRange(event.startsAt, event.endsAt, locale)
                          : `${formatWeekday(event.startsAt, locale)}, ${formatTime(event.startsAt, locale)}`
                        : t("ws.events.noDate")}
                      {event.location ? ` · ${event.location}` : ""}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone={event.status === "confirmed" ? "skog" : event.status === "cancelled" ? "rust" : "neutral"}>
                        {t(`ws.events.status.${event.status}`)}
                      </Badge>
                      <Badge tone="outline">{t(`ws.events.audience.${event.audience}`)}</Badge>
                      {publication?.status === "published" ? (
                        <Badge tone="fjord">
                          <IconGlobe size={11} />
                          {t("ws.events.published")}
                        </Badge>
                      ) : null}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageContainer>
  );
}
