import Link from "next/link";
import { TaskStatusControls } from "@/components/collaboration/workspace/TaskForms";
import { Avatar, cn } from "@/components/ui/primitives";
import { formatDate, osloToday } from "@/lib/format";
import type { Translator } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/locales";
import type { CollaborationPersona, WorkspaceTask } from "@/lib/types";

/**
 * One task in a list: title, who, when — and, for someone the database lets
 * move it, the next status one tap away. Everything else is on its own page.
 */
export function TaskCard({
  task,
  people,
  collaborationId,
  href,
  slug,
  meId,
  manager,
  t,
  locale,
}: {
  task: WorkspaceTask;
  people: Record<string, CollaborationPersona>;
  collaborationId: string;
  href: string;
  slug: string;
  meId: string;
  manager: boolean;
  t: Translator;
  locale: Locale;
}) {
  const owner = task.createdBy === meId || manager;
  const canMove = owner || task.assigneeIds.includes(meId);
  const overdue = task.dueOn && task.status !== "done" && task.status !== "cancelled" && task.dueOn < osloToday();
  const dueLabel = task.dueOn ? formatDate(`${task.dueOn}T12:00:00Z`, locale) : undefined;

  return (
    <li className="rounded-[6px] border border-line bg-surface p-3.5">
      <Link href={href} className="block text-[0.9375rem] font-medium leading-snug text-ink hover:text-skog [overflow-wrap:anywhere]">
        {task.title}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-ink-3">
        {dueLabel ? (
          <span className={cn(overdue && "font-medium text-rust")}>
            {overdue ? t("ws.tasks.overdue", { date: dueLabel }) : t("ws.tasks.dueOn", { date: dueLabel })}
          </span>
        ) : null}
        {task.assigneeIds.length > 0 ? (
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            {task.assigneeIds.map((id) => {
              const person = people[id];
              const name = person?.name ?? t("common.unknown");
              return (
                <span key={id} className="inline-flex min-w-0 items-center gap-1 text-ink-2">
                  <Avatar
                    user={{ id, name, initials: person?.initials ?? "?", communityId: collaborationId }}
                    size="xs"
                  />
                  <span className="max-w-[10rem] truncate">{name}</span>
                </span>
              );
            })}
          </span>
        ) : (
          <span>{t("ws.tasks.unassigned")}</span>
        )}
      </div>
      {canMove && task.status !== "cancelled" ? (
        <div className="mt-3">
          <TaskStatusControls task={task} slug={slug} canCancel={owner} compact />
        </div>
      ) : null}
    </li>
  );
}
