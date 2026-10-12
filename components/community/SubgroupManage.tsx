"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  deleteSubgroupAction,
  setSubgroupArchivedAction,
  updateSubgroupDetailsAction,
} from "@/app/actions";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconChevronDown, IconLock, IconPencil, IconTrash } from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/react";
import {
  SUBGROUP_DESCRIPTION_MAX,
  SUBGROUP_NAME_MAX,
  emptySubgroupFormState,
} from "@/lib/subgroup-form";
import type { Subgroup } from "@/lib/types";

function Submit({
  children,
  pendingLabel = "…",
  className,
  style,
}: Pick<React.ComponentProps<"button">, "className" | "style"> & { children: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} style={style}>
      {pending ? pendingLabel : children}
    </button>
  );
}

const fieldClass =
  "h-10 w-full rounded-[5px] border border-line-2 bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3";
const cancelClass = "h-9 rounded-[5px] px-3 text-sm text-ink-2 hover:bg-paper-2";

/**
 * What a manager can do to a group as a whole, behind one quiet "Administrer
 * gruppe" button next to its name: edit the name and description (the group's
 * chat follows), archive or reopen it, and — behind its own confirmation —
 * delete it permanently.
 *
 * Rendered only for a group the page found the viewer may manage — a
 * community admin, or a gruppeansvarlig — and every action is decided again
 * by the database. Deleting is refused while posts or events are published to
 * the group: `content` is what the database counted, and the dialog then says
 * so instead of offering a button that would fail.
 *
 * The dropdown is the shared ActionMenu and the dialogs are the shared
 * ConfirmDialog, as on a private channel's "Administrer kanal".
 */
export function SubgroupManage({
  communityId,
  subgroup,
  content,
  accent,
}: {
  communityId: string;
  subgroup: Subgroup;
  /** Posts and events scoped to the group; they are not deleted with it. */
  content: { posts: number; events: number };
  accent: string;
}) {
  const t = useT();
  const [dialog, setDialog] = useState<"edit" | "archive" | "delete" | null>(null);
  const [name, setName] = useState(subgroup.name);
  const [description, setDescription] = useState(subgroup.description);
  const [editState, editAction] = useActionState(updateSubgroupDetailsAction, emptySubgroupFormState);
  const [archiveState, archiveAction] = useActionState(setSubgroupArchivedAction, emptySubgroupFormState);
  const [deleteState, deleteAction] = useActionState(deleteSubgroupAction, emptySubgroupFormState);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // A dialog closes once the database has agreed to what it asked for.
  const [seenEdit, setSeenEdit] = useState(editState);
  if (seenEdit !== editState) {
    setSeenEdit(editState);
    if (editState.status === "ok") setDialog(null);
  }
  const [seenArchive, setSeenArchive] = useState(archiveState);
  if (seenArchive !== archiveState) {
    setSeenArchive(archiveState);
    if (archiveState.status === "ok") setDialog(null);
  }

  function closeDialog() {
    setDialog(null);
    triggerRef.current?.focus();
  }

  const hidden = (
    <>
      <input type="hidden" name="communityId" value={communityId} />
      <input type="hidden" name="subgroupId" value={subgroup.id} />
    </>
  );

  const archived = !subgroup.active;
  const blocked = content.posts > 0 || content.events > 0;

  const items: ActionMenuItem[] = [
    {
      key: "edit",
      label: t("subgroups.manage.edit"),
      icon: <IconPencil size={15} />,
      onSelect: () => {
        setName(subgroup.name);
        setDescription(subgroup.description);
        setDialog("edit");
      },
    },
    {
      key: "archive",
      label: archived ? t("subgroups.manage.restore") : t("subgroups.manage.archive"),
      icon: <IconLock size={15} />,
      separatorBefore: true,
      onSelect: () => setDialog("archive"),
    },
    {
      key: "delete",
      label: t("subgroups.manage.delete"),
      icon: <IconTrash size={15} />,
      danger: true,
      separatorBefore: true,
      onSelect: () => setDialog("delete"),
    },
  ];

  return (
    <>
      <ActionMenu
        label={t("subgroups.manage.menu")}
        triggerRef={triggerRef}
        align="right"
        trigger={(open) => (
          <>
            {t("subgroups.manage.menu")}
            <IconChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
          </>
        )}
        triggerClassName={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-line-2 px-2.5 text-[13px] text-ink-2",
          "transition-colors hover:border-ink-3 hover:text-ink",
        )}
        items={items}
      />

      <ConfirmDialog open={dialog === "edit"} onClose={closeDialog} labelledBy={`subgroup-edit-${subgroup.id}`}>
        <h3 id={`subgroup-edit-${subgroup.id}`} className="font-display text-lg leading-snug text-ink">
          {t("subgroups.edit.title", { name: subgroup.name })}
        </h3>
        <form action={editAction} className="mt-4 space-y-4">
          {hidden}
          <div>
            <label htmlFor={`subgroup-name-${subgroup.id}`} className="label mb-1 block">
              {t("subgroups.create.name")}
            </label>
            <input
              id={`subgroup-name-${subgroup.id}`}
              name="name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={SUBGROUP_NAME_MAX}
              required
              autoComplete="off"
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor={`subgroup-description-${subgroup.id}`} className="label mb-1 block">
              {t("subgroups.create.description")}{" "}
              <span className="font-normal normal-case tracking-normal text-ink-3">
                ({t("subgroups.create.optional")})
              </span>
            </label>
            <input
              id={`subgroup-description-${subgroup.id}`}
              name="description"
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={SUBGROUP_DESCRIPTION_MAX}
              autoComplete="off"
              placeholder={t("subgroups.create.descriptionPlaceholder")}
              className={fieldClass}
            />
          </div>
          {editState.status === "error" ? (
            <p role="alert" className="text-[13px] text-rust">
              {editState.error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={closeDialog} className={cancelClass}>
              {t("common.cancel")}
            </button>
            <Submit
              pendingLabel={t("subgroups.edit.saving")}
              className="h-9 rounded-[5px] px-4 text-sm font-medium text-white disabled:opacity-40"
              style={{ backgroundColor: accent }}
            >
              {t("common.save")}
            </Submit>
          </div>
        </form>
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "archive"} onClose={closeDialog} labelledBy={`subgroup-archive-${subgroup.id}`}>
        <h3 id={`subgroup-archive-${subgroup.id}`} className="font-display text-lg leading-snug text-ink">
          {t(archived ? "subgroups.restore.title" : "subgroups.archive.title", { name: subgroup.name })}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {t(archived ? "subgroups.restore.body" : "subgroups.archive.body")}
        </p>
        {archiveState.status === "error" ? (
          <p role="alert" className="mt-3 text-[13px] text-rust">
            {archiveState.error}
          </p>
        ) : null}
        <form action={archiveAction} className="mt-5 flex flex-wrap justify-end gap-2">
          {hidden}
          <input type="hidden" name="archived" value={archived ? "false" : "true"} />
          <button type="button" onClick={closeDialog} className={cancelClass}>
            {t("common.cancel")}
          </button>
          <Submit
            className="h-9 rounded-[5px] px-4 text-sm font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: accent }}
          >
            {t(archived ? "subgroups.restore.confirm" : "subgroups.archive.confirm")}
          </Submit>
        </form>
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "delete"} onClose={closeDialog} labelledBy={`subgroup-delete-${subgroup.id}`}>
        <h3 id={`subgroup-delete-${subgroup.id}`} className="font-display text-lg leading-snug text-ink">
          {t(blocked ? "subgroups.delete.blockedTitle" : "subgroups.delete.title")}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {blocked
            ? t("subgroups.delete.blocked", {
                name: subgroup.name,
                posts: content.posts,
                events: content.events,
              })
            : t("subgroups.delete.body", { name: subgroup.name })}
        </p>
        {deleteState.status === "error" ? (
          <p role="alert" className="mt-3 text-[13px] text-rust">
            {deleteState.error}
          </p>
        ) : null}
        {blocked ? (
          <div className="mt-5 flex justify-end">
            <button type="button" onClick={closeDialog} className={cancelClass}>
              {t("common.close")}
            </button>
          </div>
        ) : (
          <form action={deleteAction} className="mt-5 flex flex-wrap justify-end gap-2">
            {hidden}
            <button type="button" onClick={closeDialog} className={cancelClass}>
              {t("common.cancel")}
            </button>
            <Submit className="h-9 rounded-[5px] bg-rust px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40">
              {t("subgroups.delete.confirm")}
            </Submit>
          </form>
        )}
      </ConfirmDialog>
    </>
  );
}
