"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import {
  createTaskAction,
  setTaskStatusAction,
  updateTaskAction,
} from "@/app/collaboration-workspace-actions";
import { ActionButton } from "@/components/collaboration/ActionButton";
import {
  WorkspaceForm,
  fieldClass,
  hintClass,
  labelClass,
} from "@/components/collaboration/workspace/WorkspaceForm";
import { Avatar } from "@/components/ui/primitives";
import { TASK_DESCRIPTION_MAX, TASK_TITLE_MAX } from "@/lib/collaboration-workspace-form";
import { useT } from "@/lib/i18n/react";
import type { CollaborationPersona, WorkspaceTask, WorkspaceTaskStatus } from "@/lib/types";

export interface TaskLinkOptions {
  channels: { id: string; name: string }[];
  documents: { id: string; title: string }[];
  events: { id: string; title: string }[];
}

/**
 * Creating or editing a task. Assignees are chosen from the current team —
 * the only people the database will accept — plus, when editing, anyone
 * already assigned (who may stay even if their access has since ended).
 */
export function TaskForm({
  collaborationId,
  slug,
  team,
  links,
  task,
  extraAssignees = [],
}: {
  collaborationId: string;
  slug: string;
  team: CollaborationPersona[];
  links: TaskLinkOptions;
  task?: WorkspaceTask;
  extraAssignees?: CollaborationPersona[];
}) {
  const t = useT();
  const router = useRouter();
  const people = [...team, ...extraAssignees.filter((p) => !team.some((m) => m.id === p.id))];
  const assigned = new Set(task?.assigneeIds ?? []);
  const onSuccess = useCallback(() => router.refresh(), [router]);

  return (
    <WorkspaceForm
      action={task ? updateTaskAction : createTaskAction}
      hidden={task ? { taskId: task.id, collaborationId, slug } : { collaborationId, slug }}
      submitLabel={task ? t("ws.tasks.save") : t("ws.tasks.create")}
      resetOnSuccess={!task}
      onSuccess={onSuccess}
    >
      <div>
        <label htmlFor={`task-title-${task?.id ?? "new"}`} className={labelClass}>
          {t("ws.tasks.titleLabel")}
        </label>
        <input
          id={`task-title-${task?.id ?? "new"}`}
          name="title"
          required
          maxLength={TASK_TITLE_MAX}
          defaultValue={task?.title}
          placeholder={t("ws.tasks.titlePlaceholder")}
          className={`${fieldClass} h-10`}
        />
      </div>

      <div>
        <label htmlFor={`task-description-${task?.id ?? "new"}`} className={labelClass}>
          {t("ws.tasks.description")}
        </label>
        <textarea
          id={`task-description-${task?.id ?? "new"}`}
          name="description"
          rows={3}
          maxLength={TASK_DESCRIPTION_MAX}
          defaultValue={task?.description}
          className={`${fieldClass} resize-y py-2 leading-relaxed`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`task-due-${task?.id ?? "new"}`} className={labelClass}>
            {t("ws.tasks.due")}
          </label>
          <input
            id={`task-due-${task?.id ?? "new"}`}
            name="dueOn"
            type="date"
            defaultValue={task?.dueOn}
            className={`${fieldClass} h-10`}
          />
        </div>
      </div>

      <fieldset>
        <legend className={labelClass}>{t("ws.tasks.assignees")}</legend>
        <div className="flex flex-wrap gap-2">
          {people.map((person) => (
            <label
              key={person.id}
              className="flex min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-[5px] border border-line bg-surface py-1.5 pl-2 pr-3 text-[13px] text-ink-2 has-[:checked]:border-skog/50 has-[:checked]:bg-skog-soft has-[:checked]:text-ink"
            >
              <input
                type="checkbox"
                name="assignee"
                value={person.id}
                aria-label={person.name}
                defaultChecked={assigned.has(person.id)}
                className="accent-[var(--color-skog)]"
              />
              <Avatar user={{ ...person, communityId: collaborationId }} size="xs" />
              <span className="truncate">{person.name}</span>
            </label>
          ))}
        </div>
        <p className={hintClass}>{t("ws.tasks.assigneesHint")}</p>
      </fieldset>

      <fieldset>
        <legend className={labelClass}>{t("ws.tasks.links")}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <LinkSelect
            name="relatedChannelId"
            label={t("ws.tasks.channel")}
            none={t("ws.tasks.none")}
            value={task?.relatedChannelId}
            options={links.channels.map((c) => ({ id: c.id, label: `#${c.name}` }))}
          />
          <LinkSelect
            name="relatedDocumentId"
            label={t("ws.tasks.document")}
            none={t("ws.tasks.none")}
            value={task?.relatedDocumentId}
            options={links.documents.map((d) => ({ id: d.id, label: d.title }))}
          />
          <LinkSelect
            name="relatedEventId"
            label={t("ws.tasks.event")}
            none={t("ws.tasks.none")}
            value={task?.relatedEventId}
            options={links.events.map((e) => ({ id: e.id, label: e.title }))}
          />
        </div>
      </fieldset>
    </WorkspaceForm>
  );
}

function LinkSelect({
  name,
  label,
  none,
  value,
  options,
}: {
  name: string;
  label: string;
  none: string;
  value?: string;
  options: { id: string; label: string }[];
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12.5px] text-ink-3">{label}</span>
      <select name={name} defaultValue={value ?? ""} className={`${fieldClass} h-10 pr-8`}>
        <option value="">{none}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const NEXT: Record<WorkspaceTaskStatus, WorkspaceTaskStatus[]> = {
  todo: ["in_progress", "done"],
  in_progress: ["todo", "done"],
  done: ["in_progress"],
  cancelled: [],
};

/**
 * Status moves for someone the database will let move this task. Cancelling
 * and reopening a cancelled task are offered only to its creator and to
 * workspace managers (`canCancel`).
 */
export function TaskStatusControls({
  task,
  slug,
  canCancel,
  compact = false,
}: {
  task: WorkspaceTask;
  slug: string;
  canCancel: boolean;
  compact?: boolean;
}) {
  const t = useT();
  const statusLabel = (status: WorkspaceTaskStatus) => t(`ws.tasks.status.${status}`);

  return (
    <div className="flex flex-wrap items-start gap-2">
      {task.status === "cancelled" ? (
        canCancel ? (
          <ActionButton
            action={setTaskStatusAction}
            fields={{ taskId: task.id, status: "todo", slug }}
            label={t("ws.tasks.reopen")}
            variant="secondary"
          />
        ) : null
      ) : (
        NEXT[task.status].map((status) => (
          <ActionButton
            key={status}
            action={setTaskStatusAction}
            fields={{ taskId: task.id, status, slug }}
            label={compact ? `→ ${statusLabel(status)}` : t("ws.tasks.moveTo", { status: statusLabel(status).toLowerCase() })}
            variant="secondary"
            ariaLabel={`${task.title}: ${statusLabel(status)}`}
          />
        ))
      )}
      {!compact && canCancel && task.status !== "cancelled" ? (
        <ActionButton
          action={setTaskStatusAction}
          fields={{ taskId: task.id, status: "cancelled", slug }}
          label={t("ws.tasks.cancel")}
          variant="quiet"
          confirm={{ note: t("ws.tasks.cancelNote"), yes: t("ws.tasks.cancelConfirm") }}
        />
      ) : null}
    </div>
  );
}
