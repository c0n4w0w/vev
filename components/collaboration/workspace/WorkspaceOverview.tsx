import { getRequestLocale } from "@/lib/i18n/server";
import Link from "next/link";
import { UnitName, unitLabel } from "@/components/collaboration/UnitName";
import { IconArrowRight, IconGlobe } from "@/components/ui/icons";
import { Avatar, Badge, PageContainer, Panel, SectionHeading } from "@/components/ui/primitives";
import { getCollaborationUnits } from "@/lib/collaboration-data";
import { isRepresented } from "@/lib/collaboration-form";
import {
  getChannels,
  getDocuments,
  getEvents,
  getPublications,
  getRecentMessages,
  getTasks,
  getWorkspacePeople,
  getWorkspaceTeam,
  loadWorkspace,
} from "@/lib/collaboration-workspace-data";
import { formatDate, formatDateParts, formatFullDate, formatTime, osloToday, timeAgo } from "@/lib/format";
import { tn } from "@/lib/i18n";

/**
 * What the team needs to see first: what is coming up, what is open, what
 * was said lately and what was written. Derived from the rows themselves —
 * there is no activity log to keep in step — and nothing is counted or
 * charted beyond what a person would count themselves.
 *
 * Everything here is read under the same RLS as the pages it links to, so it
 * can never summarise something the viewer could not open.
 */
export async function WorkspaceOverview({
  slug,
  justJoinedUnit,
}: {
  slug: string;
  justJoinedUnit: boolean;
}) {
  const { collaboration, me, manager, t, base } = await loadWorkspace(slug);
  const locale = await getRequestLocale(collaboration);
  const [units, team, people, events, publications, tasks, recent, documents, channels] = await Promise.all([
    getCollaborationUnits(collaboration.id),
    getWorkspaceTeam(collaboration.id),
    getWorkspacePeople(collaboration.id),
    getEvents(collaboration.id),
    getPublications(collaboration.id),
    getTasks(collaboration.id),
    getRecentMessages(collaboration.id, 6),
    getDocuments(collaboration.id),
    getChannels(collaboration.id),
  ]);

  const active = units.filter((unit) => unit.status === "active");
  const myUnits = active.filter(isRepresented);
  const institutional = manager || myUnits.length > 0;
  const now = new Date().toISOString();
  const upcoming = events
    .filter((event) => event.status !== "cancelled" && (!event.startsAt || (event.endsAt ?? event.startsAt) >= now))
    .slice(0, 3);
  const open = tasks
    .filter((task) => task.status === "todo" || task.status === "in_progress")
    .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
  const today = osloToday();
  const channelName = new Map(channels.map((channel) => [channel.id, channel.name]));
  const recentDocuments = documents.filter((document) => document.status === "active").slice(0, 4);
  const nameOf = (id: string | null) => (id && people[id]?.name) || t("common.unknown");

  return (
    <PageContainer width="wide">
      {justJoinedUnit && myUnits.length > 0 ? (
        <Panel role="status" className="mb-6 border-skog/30 bg-skog-soft/40 p-5">
          <p className="text-[0.9375rem] font-medium text-ink">
            {t("collab.orgInvite.acceptedUnit", { unit: myUnits.map(unitLabel).join(", ") })}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{t("collab.orgInvite.acceptedOnTeam")}</p>
        </Panel>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-9">
          <section>
            <SectionHeading
              action={
                <Link href={`${base}/events`} className="text-[12.5px] text-skog hover:underline">
                  {t("ws.nav.events")}
                </Link>
              }
            >
              {t("ws.overview.upcoming")}
            </SectionHeading>
            {upcoming.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t("ws.overview.noEvents")}</p>
            ) : (
              <ul className="space-y-2.5">
                {upcoming.map((event) => (
                  <li key={event.id}>
                    <Link
                      href={`${base}/events/${event.id}`}
                      className="flex items-start gap-4 rounded-[6px] border border-line bg-surface p-4 hover:border-line-2"
                    >
                      <span className="w-14 shrink-0 text-center">
                        {event.startsAt ? (
                          <>
                            <span className="block font-display text-2xl leading-none text-ink">
                              {formatDateParts(event.startsAt, locale).day}
                            </span>
                            <span className="label mt-1 block">{formatDateParts(event.startsAt, locale).month}</span>
                          </>
                        ) : (
                          <span className="label">—</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-ink [overflow-wrap:anywhere]">{event.title}</span>
                        <span className="mt-0.5 block text-[13px] text-ink-2">
                          {event.startsAt
                            ? `${formatFullDate(event.startsAt, locale)} · ${formatTime(event.startsAt, locale)}`
                            : t("ws.events.noDate")}
                          {event.location ? ` · ${event.location}` : ""}
                        </span>
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          <Badge tone={event.status === "confirmed" ? "skog" : "neutral"}>
                            {t(`ws.events.status.${event.status}`)}
                          </Badge>
                          {publications[event.id]?.status === "published" ? (
                            <Badge tone="fjord">
                              <IconGlobe size={11} />
                              {t("ws.events.published")}
                            </Badge>
                          ) : null}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionHeading
              action={
                <Link href={`${base}/tasks`} className="text-[12.5px] text-skog hover:underline">
                  {t("ws.overview.allTasks")}
                </Link>
              }
            >
              {t("ws.overview.openTasks")}
            </SectionHeading>
            {open.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t("ws.overview.noTasks")}</p>
            ) : (
              <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">
                {open.slice(0, 6).map((task) => {
                  const overdue = task.dueOn && task.dueOn < today;
                  const mine = task.assigneeIds.includes(me.id);
                  return (
                    <li key={task.id}>
                      <Link href={`${base}/tasks/${task.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 hover:bg-paper-2/60">
                        <span className="min-w-0 flex-1 text-sm text-ink [overflow-wrap:anywhere]">{task.title}</span>
                        <span className="flex shrink-0 items-center gap-2 text-[12px] text-ink-3">
                          {mine ? <Badge tone="skog">{t("ws.overview.mine")}</Badge> : null}
                          <span>{t(`ws.tasks.status.${task.status}`)}</span>
                          {task.dueOn ? (
                            <span className={overdue ? "font-medium text-rust" : undefined}>
                              {formatDate(`${task.dueOn}T12:00:00Z`, locale)}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {open.length > 6 ? (
              <p className="mt-2 text-[12.5px] text-ink-3">{tn(locale, "ws.count.tasks", open.length)}</p>
            ) : null}
          </section>

          <section>
            <SectionHeading
              action={
                <Link href={`${base}/channels`} className="text-[12.5px] text-skog hover:underline">
                  {t("ws.overview.allChannels")}
                </Link>
              }
            >
              {t("ws.overview.activity")}
            </SectionHeading>
            {recent.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t("ws.overview.noActivity")}</p>
            ) : (
              <ul className="space-y-1">
                {recent.map((message) => {
                  const href = message.parentMessageId
                    ? `${base}/channels/${message.channelId}?thread=${message.parentMessageId}`
                    : `${base}/channels/${message.channelId}`;
                  const author = message.authorId ? people[message.authorId] : undefined;
                  return (
                    <li key={message.id}>
                      <Link href={href} className="-mx-2 flex gap-3 rounded-[6px] px-2 py-2 hover:bg-paper-2/60">
                        <Avatar
                          user={{
                            id: message.authorId ?? "ukjent",
                            name: author?.name ?? t("common.unknown"),
                            initials: author?.initials ?? "?",
                            communityId: collaboration.id,
                          }}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-ink-3">
                            <span className="font-medium text-ink">{nameOf(message.authorId)}</span>
                            <span>{t("ws.overview.inChannel", { name: channelName.get(message.channelId) ?? "…" })}</span>
                            <span>{timeAgo(message.createdAt, locale)}</span>
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-[13.5px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
                            {message.body}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <SectionHeading
              action={
                <Link href={`${base}/docs`} className="text-[12.5px] text-skog hover:underline">
                  {t("ws.overview.allDocs")}
                </Link>
              }
            >
              {t("ws.overview.docs")}
            </SectionHeading>
            {recentDocuments.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t("ws.overview.noDocs")}</p>
            ) : (
              <ul className="grid gap-2.5 sm:grid-cols-2">
                {recentDocuments.map((document) => (
                  <li key={document.id}>
                    <Link href={`${base}/docs/${document.id}`} className="block h-full rounded-[6px] border border-line bg-surface p-3.5 hover:border-line-2">
                      <span className="block text-sm font-medium text-ink [overflow-wrap:anywhere]">{document.title}</span>
                      <span className="mt-1 block text-[12px] text-ink-3">
                        {t("ws.docs.updated", { when: timeAgo(document.updatedAt, locale), name: nameOf(document.updatedBy) })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-7">
          {collaboration.description ? (
            <section>
              <SectionHeading>{t("collab.page.about")}</SectionHeading>
              <p className="whitespace-pre-line text-[13.5px] leading-[1.7] text-ink-2 [overflow-wrap:anywhere]">
                {collaboration.description}
              </p>
            </section>
          ) : null}

          <section>
            <SectionHeading>{t("ws.overview.organizations")}</SectionHeading>
            <ul className="space-y-2 text-sm text-ink-2">
              {active.map((unit) => (
                <li key={unit.key} className="min-w-0">
                  <UnitName unit={unit} className="max-w-full" />
                </li>
              ))}
            </ul>
          </section>

          <section>
            <SectionHeading>{t("ws.overview.people")}</SectionHeading>
            <p className="mb-3 text-[13px] text-ink-2">{tn(locale, "ws.count.people", team.length)}</p>
            <div className="flex flex-wrap gap-1.5">
              {team.slice(0, 12).map((person) => (
                <Avatar key={person.id} user={{ ...person, communityId: collaboration.id }} size="sm" />
              ))}
            </div>
            <Link href={`${base}/participants`} className="mt-3 inline-flex items-center gap-1 text-[13px] text-skog hover:underline">
              {t("ws.overview.peopleLink")}
              <IconArrowRight size={13} />
            </Link>
          </section>

          {institutional ? (
            <section className="border-t border-line pt-5">
              <Link href={`${base}/participants#ansvar`} className="inline-flex items-center gap-1 text-[13px] font-medium text-ink hover:text-skog">
                {t("ws.overview.manageLink")}
                <IconArrowRight size={13} />
              </Link>
            </section>
          ) : null}
        </aside>
      </div>
    </PageContainer>
  );
}
