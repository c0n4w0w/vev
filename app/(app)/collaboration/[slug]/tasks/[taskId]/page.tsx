import Link from "next/link";
import { notFound } from "next/navigation";
import { TaskForm, TaskStatusControls } from "@/components/collaboration/workspace/TaskForms";
import { IconArrowLeft } from "@/components/ui/icons";
import { Avatar, Badge, PageContainer, Panel, SectionHeading } from "@/components/ui/primitives";
import {
  getChannels,
  getDocuments,
  getEvents,
  getTask,
  getWorkspacePeople,
  getWorkspaceTeam,
  loadWorkspace,
} from "@/lib/collaboration-workspace-data";
import { UUID } from "@/lib/collaboration-workspace-form";
import { formatFullDate, timeAgo } from "@/lib/format";
import type { CollaborationPersona } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/collaboration/[slug]/tasks/[taskId]">) {
  const { slug, taskId } = await params;
  const { collaboration } = await loadWorkspace(slug);
  const task = UUID.test(taskId) ? await getTask(collaboration.id, taskId) : undefined;
  return { title: task ? `${task.title} · ${collaboration.name}` : collaboration.name };
}

/**
 * One task. Status moves for its creator, its assignees and workspace
 * managers; the edit form for its creator and workspace managers. Everyone
 * else on the team reads it. The database holds the same line.
 */
export default async function TaskPage({ params }: PageProps<"/collaboration/[slug]/tasks/[taskId]">) {
  const { slug, taskId } = await params;
  const { collaboration, me, manager, t, base } = await loadWorkspace(slug);
  if (!UUID.test(taskId)) notFound();
  const locale = collaboration.defaultLocale;

  const [task, people, team, channels, documents, events] = await Promise.all([
    getTask(collaboration.id, taskId),
    getWorkspacePeople(collaboration.id),
    getWorkspaceTeam(collaboration.id),
    getChannels(collaboration.id),
    getDocuments(collaboration.id),
    getEvents(collaboration.id),
  ]);
  if (!task) notFound();

  const owner = task.createdBy === me.id || manager;
  const canMove = owner || task.assigneeIds.includes(me.id);
  const person = (id: string | null): CollaborationPersona | undefined => (id ? people[id] : undefined);
  const channel = channels.find((c) => c.id === task.relatedChannelId);
  const document = documents.find((d) => d.id === task.relatedDocumentId);
  const event = events.find((e) => e.id === task.relatedEventId);
  const extraAssignees = task.assigneeIds
    .map((id) => people[id])
    .filter((p): p is CollaborationPersona => Boolean(p) && !team.some((m) => m.id === p!.id));

  return (
    <PageContainer width="narrow">
      <Link
        href={`${base}/tasks`}
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink"
      >
        <IconArrowLeft size={14} />
        {t("ws.tasks.back")}
      </Link>

      <header className="mb-6 border-b border-line pb-5">
        <Badge tone={task.status === "done" ? "skog" : task.status === "cancelled" ? "outline" : "fjord"}>
          {t(`ws.tasks.status.${task.status}`)}
        </Badge>
        <h1 className="mt-2 font-display text-[1.625rem] leading-tight text-ink [overflow-wrap:anywhere]">
          {task.title}
        </h1>
        <p className="mt-2 text-[13px] text-ink-3">
          {t("ws.tasks.createdBy", { name: person(task.createdBy)?.name ?? t("common.unknown") })} ·{" "}
          {timeAgo(task.createdAt, locale)}
        </p>
      </header>

      <div className="space-y-6">
        {task.description ? (
          <p className="whitespace-pre-wrap text-[0.9375rem] leading-[1.7] text-ink-2 [overflow-wrap:anywhere]">
            {task.description}
          </p>
        ) : null}

        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="label mb-1.5">{t("ws.tasks.due")}</dt>
            <dd className="text-ink-2">{task.dueOn ? formatFullDate(`${task.dueOn}T12:00:00Z`, locale) : "—"}</dd>
          </div>
          <div>
            <dt className="label mb-1.5">{t("ws.tasks.assignees")}</dt>
            <dd className="flex flex-wrap gap-2">
              {task.assigneeIds.length === 0 ? <span className="text-ink-3">{t("ws.tasks.unassigned")}</span> : null}
              {task.assigneeIds.map((id) => {
                const p = person(id);
                const name = p?.name ?? t("common.unknown");
                return (
                  <span key={id} className="inline-flex min-w-0 items-center gap-1.5 text-ink-2">
                    <Avatar user={{ id, name, initials: p?.initials ?? "?", communityId: collaboration.id }} size="xs" />
                    <span className="truncate">{name}</span>
                  </span>
                );
              })}
            </dd>
          </div>
          {channel || document || event ? (
            <div className="sm:col-span-2">
              <dt className="label mb-1.5">{t("ws.tasks.links")}</dt>
              <dd className="flex flex-wrap gap-x-4 gap-y-1">
                {channel ? (
                  <Link href={`${base}/channels/${channel.id}`} className="text-skog hover:underline">
                    #{channel.name}
                  </Link>
                ) : null}
                {document ? (
                  <Link href={`${base}/docs/${document.id}`} className="text-skog hover:underline [overflow-wrap:anywhere]">
                    {document.title}
                  </Link>
                ) : null}
                {event ? (
                  <Link href={`${base}/events/${event.id}`} className="text-skog hover:underline [overflow-wrap:anywhere]">
                    {event.title}
                  </Link>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>

        {canMove ? (
          <section>
            <SectionHeading>{t("ws.tasks.statusLabel")}</SectionHeading>
            <TaskStatusControls task={task} slug={collaboration.slug} canCancel={owner} />
          </section>
        ) : null}

        {owner ? (
          <section>
            <SectionHeading>{t("ws.tasks.edit")}</SectionHeading>
            <Panel className="p-4 sm:p-5">
              <TaskForm
                collaborationId={collaboration.id}
                slug={collaboration.slug}
                team={team}
                extraAssignees={extraAssignees}
                task={task}
                links={{
                  channels: channels.filter((c) => c.status === "active" || c.id === task.relatedChannelId).map((c) => ({ id: c.id, name: c.name })),
                  documents: documents.filter((d) => d.status === "active" || d.id === task.relatedDocumentId).map((d) => ({ id: d.id, title: d.title })),
                  events: events.map((e) => ({ id: e.id, title: e.title })),
                }}
              />
            </Panel>
          </section>
        ) : (
          <p className="text-[12.5px] text-ink-3">{t("ws.tasks.readOnly")}</p>
        )}
      </div>
    </PageContainer>
  );
}
