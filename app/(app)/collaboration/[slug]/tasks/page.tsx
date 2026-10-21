import { getRequestLocale } from "@/lib/i18n/server";
import { TaskCard } from "@/components/collaboration/workspace/TaskCard";
import { TaskForm } from "@/components/collaboration/workspace/TaskForms";
import { IconPlus } from "@/components/ui/icons";
import { PageContainer, PageHeader } from "@/components/ui/primitives";
import {
  getChannels,
  getDocuments,
  getEvents,
  getTasks,
  getWorkspacePeople,
  getWorkspaceTeam,
  loadWorkspace,
} from "@/lib/collaboration-workspace-data";
import { tn } from "@/lib/i18n";
import type { WorkspaceTaskStatus } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/collaboration/[slug]/tasks">) {
  const { slug } = await params;
  const { t, collaboration } = await loadWorkspace(slug);
  return { title: `${t("ws.tasks.title")} · ${collaboration.name}` };
}

const COLUMNS: WorkspaceTaskStatus[] = ["todo", "in_progress", "done"];

/**
 * Tasks in three plain groups — to do, in progress, done — rather than a
 * board to drag things around on. Side by side on a wide screen, one after
 * another on a phone. Cancelled tasks are kept, out of the way.
 */
export default async function TasksPage({ params }: PageProps<"/collaboration/[slug]/tasks">) {
  const { slug } = await params;
  const { collaboration, me, manager, t, base } = await loadWorkspace(slug);
  const locale = await getRequestLocale(collaboration);
  const [tasks, people, team, channels, documents, events] = await Promise.all([
    getTasks(collaboration.id),
    getWorkspacePeople(collaboration.id),
    getWorkspaceTeam(collaboration.id),
    getChannels(collaboration.id),
    getDocuments(collaboration.id),
    getEvents(collaboration.id),
  ]);

  const links = {
    channels: channels.filter((c) => c.status === "active").map((c) => ({ id: c.id, name: c.name })),
    documents: documents.filter((d) => d.status === "active").map((d) => ({ id: d.id, title: d.title })),
    events: events.map((e) => ({ id: e.id, title: e.title })),
  };
  const cancelled = tasks.filter((task) => task.status === "cancelled");

  const card = (task: (typeof tasks)[number]) => (
    <TaskCard
      key={task.id}
      task={task}
      people={people}
      collaborationId={collaboration.id}
      href={`${base}/tasks/${task.id}`}
      slug={collaboration.slug}
      meId={me.id}
      manager={manager}
      t={t}
      locale={locale}
    />
  );

  return (
    <PageContainer width="wide">
      <PageHeader title={t("ws.tasks.title")} lead={t("ws.tasks.lead")} />

      <details className="mb-8 rounded-[6px] border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
          <IconPlus size={16} className="text-skog" />
          {t("ws.tasks.new")}
        </summary>
        <div className="border-t border-line p-4">
          <TaskForm collaborationId={collaboration.id} slug={collaboration.slug} team={team} links={links} />
        </div>
      </details>

      <div className="grid gap-6 lg:grid-cols-3">
        {COLUMNS.map((status) => {
          const inColumn = tasks.filter((task) => task.status === status);
          return (
            <section key={status} aria-labelledby={`tasks-${status}`} className="min-w-0">
              <h2 id={`tasks-${status}`} className="mb-3 flex items-baseline gap-2">
                <span className="label">{t(`ws.tasks.status.${status}`)}</span>
                <span className="text-[12px] text-ink-3">{inColumn.length}</span>
              </h2>
              {inColumn.length > 0 ? (
                <ul className="space-y-2.5">{inColumn.map(card)}</ul>
              ) : (
                <p className="rounded-[6px] border border-dashed border-line-2 px-4 py-5 text-center text-[13px] text-ink-3">
                  {t("ws.tasks.empty")}
                </p>
              )}
            </section>
          );
        })}
      </div>

      {cancelled.length > 0 ? (
        <details className="mt-10">
          <summary className="cursor-pointer text-[13px] text-ink-3 hover:text-ink">
            {tn(locale, "ws.tasks.cancelledCount", cancelled.length)}
          </summary>
          <ul className="mt-3 grid gap-2.5 opacity-80 sm:grid-cols-2 lg:grid-cols-3">{cancelled.map(card)}</ul>
        </details>
      ) : null}
    </PageContainer>
  );
}
