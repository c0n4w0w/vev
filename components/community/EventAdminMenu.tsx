"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { cancelEventAction, deleteEventAction, restoreEventAction } from "@/app/actions";
import { EventComposer, type EditableEvent } from "@/components/community/EventComposer";
import {
  IconCalendarCheck,
  IconCalendarX,
  IconChevronDown,
  IconPencil,
  IconTrash,
} from "@/components/ui/icons";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/components/ui/primitives";
import { emptyEventLifecycleFormState, type EventLifecycleFormState } from "@/lib/event-form";
import { useT } from "@/lib/i18n/react";

function Submit({
  children,
  disabled,
  className,
  style,
}: {
  children: string;
  disabled?: boolean;
  className: string;
  style?: React.CSSProperties;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={className} style={style}>
      {pending ? "…" : children}
    </button>
  );
}

/**
 * Everything a manager can do to an event, behind one quiet "Administrer"
 * button under the badges: edit (the full editor, description included),
 * cancel or restore (each behind its confirmation dialog), and — for the
 * community's admins only — permanent deletion behind its two-step dialog.
 *
 * Rendered only for people the page found may manage or delete the event;
 * every action is decided again by the database (events_update /
 * cancel_event / restore_event: can_manage_event; delete: admins only).
 *
 * The dropdown itself is the shared ActionMenu (keyboard, Escape and
 * outside-click behaviour live there); the dialogs are the shared
 * ConfirmDialog.
 */
export function EventAdminMenu({
  communityId,
  communityName,
  event,
  cancelled,
  ended,
  canManage,
  canDelete,
  accent,
}: {
  communityId: string;
  communityName: string;
  event: EditableEvent;
  cancelled: boolean;
  ended: boolean;
  canManage: boolean;
  canDelete: boolean;
  accent: string;
}) {
  const t = useT();
  const [editRequest, setEditRequest] = useState(0);
  const [dialog, setDialog] = useState<"cancel" | "restore" | "delete" | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [cancelState, cancelAction] = useActionState(cancelEventAction, emptyEventLifecycleFormState);
  const [restoreState, restoreAction] = useActionState(restoreEventAction, emptyEventLifecycleFormState);
  const [deleteState, deleteAction] = useActionState(deleteEventAction, emptyEventLifecycleFormState);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The latest outcome of cancel, restore or delete. A success closes its
  // dialog and leaves a short note by the button; an error stays in the
  // dialog with the reason.
  const [last, setLast] = useState<EventLifecycleFormState>(emptyEventLifecycleFormState);
  const [seen, setSeen] = useState({ cancelState, restoreState, deleteState });
  if (seen.cancelState !== cancelState || seen.restoreState !== restoreState || seen.deleteState !== deleteState) {
    const changed =
      seen.cancelState !== cancelState ? cancelState : seen.restoreState !== restoreState ? restoreState : deleteState;
    setSeen({ cancelState, restoreState, deleteState });
    setLast(changed);
    if (changed.status === "ok") setDialog(null);
  }

  if (!canManage && !canDelete) return null;

  function choose(action: "edit" | "cancel" | "restore" | "delete") {
    setLast(emptyEventLifecycleFormState);
    if (action === "edit") setEditRequest((n) => n + 1);
    else setDialog(action);
  }

  function closeDialog() {
    setDialog(null);
    setAcknowledged(false);
    triggerRef.current?.focus();
  }

  const hidden = (
    <>
      <input type="hidden" name="communityId" value={communityId} />
      <input type="hidden" name="eventId" value={event.id} />
    </>
  );
  const items: ActionMenuItem[] = [];
  if (canManage) {
    items.push({ key: "edit", label: t("events.manage.edit"), icon: <IconPencil size={15} />, onSelect: () => choose("edit") });
    if (!ended) {
      items.push(
        cancelled
          ? { key: "restore", label: t("events.manage.restore"), icon: <IconCalendarCheck size={15} />, onSelect: () => choose("restore") }
          : { key: "cancel", label: t("events.manage.cancel"), icon: <IconCalendarX size={15} />, onSelect: () => choose("cancel") },
      );
    }
  }
  if (canDelete) {
    items.push({
      key: "delete",
      label: t("events.manage.delete"),
      icon: <IconTrash size={15} />,
      danger: true,
      separatorBefore: canManage,
      onSelect: () => choose("delete"),
    });
  }

  const dialogError =
    last.status === "error" && dialog ? (
      <p role="alert" className="mt-3 text-[13px] text-rust">
        {last.error}
      </p>
    ) : null;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <ActionMenu
          label={t("events.manage.menu")}
          triggerRef={triggerRef}
          trigger={(open) => (
            <>
              {t("events.manage.menu")}
              <IconChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
            </>
          )}
          triggerClassName={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-line-2 px-2.5 text-[13px] text-ink-2",
            "transition-colors hover:border-ink-3 hover:text-ink",
          )}
          items={items}
        />

        {last.status === "ok" && dialog === null ? (
          <p role="status" className="text-[12px] text-ink-3">
            {last.message}
          </p>
        ) : null}
      </div>

      {canManage ? (
        <EventComposer
          communityId={communityId}
          communityName={communityName}
          accent={accent}
          event={event}
          openRequest={editRequest}
        />
      ) : null}

      <ConfirmDialog open={dialog === "cancel"} onClose={closeDialog} labelledBy="event-cancel-title">
        <h3 id="event-cancel-title" className="font-display text-lg leading-snug text-ink">
          {t("events.manage.cancelTitle", { title: event.title })}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{t("events.manage.cancelBody")}</p>
        {dialogError}
        <form action={cancelAction} className="mt-5 flex flex-wrap justify-end gap-2">
          {hidden}
          <button type="button" onClick={closeDialog} className="h-9 rounded-[5px] px-3 text-sm text-ink-2 hover:bg-paper-2">
            {t("events.manage.keep")}
          </button>
          <Submit
            className="h-9 rounded-[5px] px-4 text-sm font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: accent }}
          >
            {t("events.manage.cancelConfirm")}
          </Submit>
        </form>
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "restore"} onClose={closeDialog} labelledBy="event-restore-title">
        <h3 id="event-restore-title" className="font-display text-lg leading-snug text-ink">
          {t("events.manage.restoreTitle", { title: event.title })}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{t("events.manage.restoreBody")}</p>
        {dialogError}
        <form action={restoreAction} className="mt-5 flex flex-wrap justify-end gap-2">
          {hidden}
          <button type="button" onClick={closeDialog} className="h-9 rounded-[5px] px-3 text-sm text-ink-2 hover:bg-paper-2">
            {t("common.cancel")}
          </button>
          <Submit
            className="h-9 rounded-[5px] px-4 text-sm font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: accent }}
          >
            {t("events.manage.restoreConfirm")}
          </Submit>
        </form>
      </ConfirmDialog>

      {canDelete ? (
        <ConfirmDialog open={dialog === "delete"} onClose={closeDialog} labelledBy="event-delete-title">
          <h3 id="event-delete-title" className="font-display text-lg leading-snug text-ink">
            {t("events.manage.deleteTitle", { title: event.title })}
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{t("events.manage.deleteBody")}</p>
          <p className="mt-3 text-[13px] font-medium text-ink">
            {t("events.manage.deleteCount", { count: event.attendeeCount })}
          </p>
          {dialogError}
          <form action={deleteAction} className="mt-4">
            {hidden}
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-snug text-ink-2">
              <input
                type="checkbox"
                name="acknowledged"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5"
              />
              <span>{t("events.manage.deleteAck")}</span>
            </label>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={closeDialog} className="h-9 rounded-[5px] px-3 text-sm text-ink-2 hover:bg-paper-2">
                {t("common.cancel")}
              </button>
              <Submit
                disabled={!acknowledged}
                className={cn(
                  "h-9 rounded-[5px] bg-rust px-4 text-sm font-medium text-white transition-opacity",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                )}
              >
                {t("events.manage.deleteConfirm")}
              </Submit>
            </div>
          </form>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
