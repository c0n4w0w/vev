import { getRequestLocale } from "@/lib/i18n/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publishEventAction, unpublishEventAction } from "@/app/collaboration-workspace-actions";
import { ActionButton } from "@/components/collaboration/ActionButton";
import { unitLabel } from "@/components/collaboration/UnitName";
import { EventForm, ImagePicker, OrganizerPicker } from "@/components/collaboration/workspace/EventForms";
import { IconArrowLeft, IconExternal, IconGlobe, IconLock } from "@/components/ui/icons";
import { Badge, PageContainer, Panel, SectionHeading } from "@/components/ui/primitives";
import { getCollaborationUnits } from "@/lib/collaboration-data";
import {
  getEvent,
  getFiles,
  getPublications,
  loadWorkspace,
} from "@/lib/collaboration-workspace-data";
import { IMAGE_MIME_TYPES } from "@/lib/collaboration-file-type";
import { UUID } from "@/lib/collaboration-workspace-form";
import { formatEventRange, formatTime, formatWeekday, osloInputParts, timeAgo } from "@/lib/format";
import type { CollaborationUnit, EventPublication, WorkspaceEvent } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/collaboration/[slug]/events/[eventId]">) {
  const { slug, eventId } = await params;
  const { collaboration } = await loadWorkspace(slug);
  const event = UUID.test(eventId) ? await getEvent(collaboration.id, eventId) : undefined;
  return { title: event ? `${event.title} · ${collaboration.name}` : collaboration.name };
}

/**
 * Whether what is live differs from the private plan. Publishing is a
 * snapshot: editing the plan never changes the public page by itself, so the
 * team is told when the two have drifted apart.
 */
function drifted(
  event: WorkspaceEvent,
  publication: EventPublication,
  units: CollaborationUnit[],
): boolean {
  const chosen = event.organizerParticipantIds
    .filter((id) => event.organizerConsentIds.includes(id))
    .map((id) => units.find((unit) => unit.participantId === id && unit.status === "active"))
    .filter((unit): unit is CollaborationUnit => Boolean(unit))
    .map((unit) => `${unit.communityName}|${unit.localGroupName ?? ""}`);
  const published = publication.organizers.map((o) => `${o.communityName}|${o.localGroupName ?? ""}`);
  return (
    event.title !== publication.title ||
    (event.description ?? "") !== (publication.description ?? "") ||
    event.startsAt !== publication.startsAt ||
    (event.endsAt ?? "") !== (publication.endsAt ?? "") ||
    (event.location ?? "") !== (publication.location ?? "") ||
    event.audience !== publication.audience ||
    (event.registrationUrl ?? "") !== (publication.registrationUrl ?? "") ||
    (event.status === "cancelled") !== publication.isCancelled ||
    (event.publicImageFileId ?? "") !== (publication.imageSourceFileId ?? "") ||
    chosen.join("\n") !== published.join("\n")
  );
}

export default async function EventPage({ params }: PageProps<"/collaboration/[slug]/events/[eventId]">) {
  const { slug, eventId } = await params;
  const { collaboration, manager, t, base } = await loadWorkspace(slug);
  if (!UUID.test(eventId)) notFound();
  const locale = await getRequestLocale(collaboration);

  const [event, publications, units, files] = await Promise.all([
    getEvent(collaboration.id, eventId),
    getPublications(collaboration.id),
    getCollaborationUnits(collaboration.id),
    getFiles(collaboration.id),
  ]);
  if (!event) notFound();

  const publication = publications[event.id];
  const live = publication?.status === "published";
  const publishable = event.audience === "public" && event.status !== "draft" && Boolean(event.startsAt);
  const activeUnits = units.filter(
    (unit): unit is CollaborationUnit & { participantId: string } => unit.status === "active" && unit.participantId !== null,
  );
  const images = files.filter((file) => IMAGE_MIME_TYPES.has(file.mimeType)).map((file) => ({ id: file.id, name: file.displayName }));
  const start = event.startsAt ? osloInputParts(event.startsAt) : undefined;
  const end = event.endsAt ? osloInputParts(event.endsAt) : undefined;
  const when = event.startsAt
    ? event.endsAt
      ? formatEventRange(event.startsAt, event.endsAt, locale)
      : `${formatWeekday(event.startsAt, locale)}, ${formatTime(event.startsAt, locale)}`
    : t("ws.events.noDate");
  const fields = { eventId: event.id, collaborationId: collaboration.id, slug: collaboration.slug };

  return (
    <PageContainer width="wide">
      <Link href={`${base}/events`} className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <IconArrowLeft size={14} />
        {t("ws.events.back")}
      </Link>

      <header className="mb-8 border-b border-line pb-6">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="neutral">
            <IconLock size={11} />
            {t("ws.events.private")}
          </Badge>
          <Badge tone={event.status === "confirmed" ? "skog" : event.status === "cancelled" ? "rust" : "neutral"}>
            {t(`ws.events.status.${event.status}`)}
          </Badge>
          <Badge tone="outline">{t(`ws.events.audience.${event.audience}`)}</Badge>
        </div>
        <h1 className="mt-3 font-display text-[1.75rem] leading-tight text-ink [overflow-wrap:anywhere] sm:text-[2rem]">
          {event.title}
        </h1>
        <p className="mt-2 text-[0.9375rem] text-ink-2">
          {when}
          {event.location ? ` · ${event.location}` : ""}
        </p>
      </header>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0">
          <SectionHeading>{t("ws.events.edit")}</SectionHeading>
          {manager ? (
            <Panel className="p-4 sm:p-5">
              <EventForm
                collaborationId={collaboration.id}
                slug={collaboration.slug}
                event={event}
                defaults={{ date: start?.date ?? "", startTime: start?.time ?? "", endTime: end?.time ?? "" }}
              />
            </Panel>
          ) : (
            <div className="space-y-5">
              {event.description ? (
                <p className="whitespace-pre-wrap text-[0.9375rem] leading-[1.7] text-ink-2 [overflow-wrap:anywhere]">
                  {event.description}
                </p>
              ) : null}
              {event.registrationUrl ? (
                <p className="text-sm">
                  <a href={event.registrationUrl} rel="noopener noreferrer" target="_blank" className="text-skog hover:underline [overflow-wrap:anywhere]">
                    {event.registrationUrl}
                  </a>
                </p>
              ) : null}
              {event.internalNotes ? (
                <div className="rounded-[6px] border border-dashed border-line-2 bg-paper-2/40 p-4">
                  <p className="label mb-2 flex items-center gap-1.5">
                    <IconLock size={11} />
                    {t("ws.events.notes")}
                  </p>
                  <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
                    {event.internalNotes}
                  </p>
                </div>
              ) : null}
              <p className="text-[12.5px] text-ink-3">{t("ws.events.readOnly")}</p>
            </div>
          )}
        </section>

        <aside className="min-w-0 space-y-5">
          <Panel className="p-4 sm:p-5">
            <h2 className="flex items-center gap-2 font-display text-lg text-ink">
              <IconGlobe size={18} className="text-ink-3" />
              {t("ws.pub.title")}
            </h2>

            {publication ? (
              <div className="mt-3 space-y-2">
                <Badge tone={live ? "fjord" : "outline"}>{live ? t("ws.pub.live") : t("ws.pub.down")}</Badge>
                <p className="text-[12.5px] text-ink-3">{t("ws.pub.since", { when: timeAgo(publication.publishedAt, locale) })}</p>
                {live ? (
                  <a
                    href={`/arrangement/${publication.slug}`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex max-w-full items-center gap-1.5 text-[13px] font-medium text-skog hover:underline"
                  >
                    <span className="truncate">{t("ws.pub.view")}</span>
                    <IconExternal size={13} className="shrink-0" />
                  </a>
                ) : null}
                {live ? (
                  <p className={`rounded-[5px] px-3 py-2 text-[12.5px] leading-relaxed ${drifted(event, publication, units) ? "border border-rust/25 bg-rust-soft text-rust" : "bg-skog-soft text-skog"}`}>
                    {drifted(event, publication, units) ? t("ws.pub.drift") : t("ws.pub.inSync")}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{t("ws.pub.notPublished")}</p>
            )}

            {manager ? (
              <div className="mt-4 space-y-3 border-t border-line pt-4">
                {!publishable ? <p className="text-[12.5px] leading-relaxed text-ink-3">{t("ws.pub.requirements")}</p> : null}
                <div className="flex flex-wrap items-start gap-2">
                  {publishable ? (
                    <ActionButton
                      action={publishEventAction}
                      fields={fields}
                      label={!publication ? t("ws.pub.publish") : live ? t("ws.pub.update") : t("ws.pub.republish")}
                      variant="primary"
                    />
                  ) : null}
                  {live ? (
                    <ActionButton
                      action={unpublishEventAction}
                      fields={fields}
                      label={t("ws.pub.unpublish")}
                      variant="quiet"
                      confirm={{ note: t("ws.pub.unpublishNote"), yes: t("ws.pub.unpublishConfirm") }}
                    />
                  ) : null}
                </div>
                <p className="text-[12px] leading-relaxed text-ink-3">{t("ws.pub.contents")}</p>
              </div>
            ) : null}
          </Panel>

          {manager ? (
            <>
              <Panel className="p-4 sm:p-5">
                <OrganizerPicker
                  eventId={event.id}
                  slug={collaboration.slug}
                  options={activeUnits.map((unit) => ({
                    participantId: unit.participantId,
                    label: unitLabel(unit),
                    consent: !event.organizerParticipantIds.includes(unit.participantId)
                      ? "notAsked"
                      : event.organizerConsentIds.includes(unit.participantId)
                        ? "approved"
                        : "pending",
                  }))}
                  selected={event.organizerParticipantIds}
                />
              </Panel>
              <Panel className="p-4 sm:p-5">
                <ImagePicker eventId={event.id} slug={collaboration.slug} images={images} selected={event.publicImageFileId} />
              </Panel>
            </>
          ) : null}
        </aside>
      </div>
    </PageContainer>
  );
}
