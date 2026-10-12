"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  addPrivateChannelParticipantAction,
  deletePrivateChannelAction,
  removePrivateChannelParticipantAction,
  setPrivateChannelArchivedAction,
  setPrivateChannelManagerAction,
} from "@/app/actions";
import { PrivateChannelParticipantIdentity } from "@/components/community/PrivateChannelParticipants";
import { PrivateChannelParticipantSearch } from "@/components/community/PrivateChannelParticipantSearch";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconChevronDown, IconLock, IconPencil, IconTrash, IconUsers } from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/react";
import { emptyPrivateChannelFormState } from "@/lib/private-channel-form";
import type { Channel, PrivateChannelParticipant } from "@/lib/types";

function Submit({
  children,
  className,
  style,
  ...props
}: Omit<React.ComponentProps<"button">, "type" | "children"> & { children: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} style={style} {...props}>
      {pending ? "…" : children}
    </button>
  );
}

const quietButton =
  "h-8 rounded-[5px] border border-line-2 px-3 text-[13px] text-ink-2 transition-colors hover:border-ink-3 disabled:opacity-40";

/**
 * Everything a manager can do to a private lokallag channel, behind one quiet
 * "Administrer kanal" button in its header: edit the name and description
 * (the channel's own intro card turns into the editor), see and change who is
 * in it, archive or reopen it, and — apart from those, behind its own
 * confirmation — delete it permanently, whether it is active or archived.
 *
 * Rendered only for someone the page found may manage the channel — a
 * community admin, or a lokallagsleder who manages it — and every action is
 * decided again by the database. The manager mark is offered to admins only,
 * and only for a participant who leads the channel's lokallag.
 *
 * Deleting shows nothing as done here: the action redirects to the lokallag's
 * main chat once the database has removed the channel, and a refusal stays in
 * the dialog with the reason.
 *
 * The dropdown is the shared ActionMenu and the dialogs are the shared
 * ConfirmDialog, as on an event's "Administrer".
 */
export function PrivateChannelAdmin({
  communityId,
  communityName,
  channel,
  localGroup,
  roster,
  viewerIsAdmin,
  accent,
  onEdit,
}: {
  communityId: string;
  communityName: string;
  channel: Channel;
  localGroup: { id: string; name: string };
  roster: PrivateChannelParticipant[];
  viewerIsAdmin: boolean;
  accent: string;
  /** Opens the intro card's editor. */
  onEdit: () => void;
}) {
  const t = useT();
  const [dialog, setDialog] = useState<"participants" | "archive" | "delete" | null>(null);
  const [addState, addAction] = useActionState(addPrivateChannelParticipantAction, emptyPrivateChannelFormState);
  const [removeState, removeAction] = useActionState(
    removePrivateChannelParticipantAction,
    emptyPrivateChannelFormState,
  );
  const [managerState, managerAction] = useActionState(
    setPrivateChannelManagerAction,
    emptyPrivateChannelFormState,
  );
  const [archiveState, archiveAction] = useActionState(
    setPrivateChannelArchivedAction,
    emptyPrivateChannelFormState,
  );
  const [deleteState, deleteAction] = useActionState(deletePrivateChannelAction, emptyPrivateChannelFormState);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Archiving or reopening closes its dialog once the database has agreed.
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
      <input type="hidden" name="channelId" value={channel.id} />
    </>
  );

  const items: ActionMenuItem[] = [
    { key: "edit", label: t("privateChannel.manage.edit"), icon: <IconPencil size={15} />, onSelect: onEdit },
    {
      key: "participants",
      label: t("privateChannel.manage.participants"),
      icon: <IconUsers size={15} />,
      onSelect: () => setDialog("participants"),
    },
    {
      key: "archive",
      label: channel.archived ? t("privateChannel.manage.restore") : t("privateChannel.manage.archive"),
      icon: <IconLock size={15} />,
      separatorBefore: true,
      onSelect: () => setDialog("archive"),
    },
    {
      key: "delete",
      label: t("privateChannel.manage.delete"),
      icon: <IconTrash size={15} />,
      danger: true,
      separatorBefore: true,
      onSelect: () => setDialog("delete"),
    },
  ];

  const participantError = [removeState, managerState, addState].find((state) => state.status === "error");

  return (
    <>
      <ActionMenu
        label={t("privateChannel.manage.menu")}
        triggerRef={triggerRef}
        align="right"
        trigger={(open) => (
          <>
            {t("privateChannel.manage.menu")}
            <IconChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
          </>
        )}
        triggerClassName={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-line-2 px-2.5 text-[13px] text-ink-2",
          "transition-colors hover:border-ink-3 hover:text-ink",
        )}
        items={items}
      />

      <ConfirmDialog
        open={dialog === "participants"}
        onClose={closeDialog}
        labelledBy="private-channel-participants-title"
      >
        <h3 id="private-channel-participants-title" className="font-display text-lg leading-snug text-ink">
          {t("privateChannel.participants.title", { name: channel.name })}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {t("privateChannel.participants.lead", { community: communityName })}
        </p>

        <div className="mt-4 space-y-4">
          {roster.length === 0 ? (
            <p className="text-[13px] text-ink-3">{t("privateChannel.participants.empty")}</p>
          ) : (
            <ul className="space-y-1.5">
              {roster.map((person) => (
                <li
                  key={person.userId}
                  className="flex flex-wrap items-center gap-2 rounded-[5px] border border-line px-3 py-2"
                >
                  <PrivateChannelParticipantIdentity communityId={communityId} person={person} />
                  {viewerIsAdmin && (person.isManager || person.isLeader) ? (
                    <form action={managerAction}>
                      {hidden}
                      <input type="hidden" name="userId" value={person.userId} />
                      <input type="hidden" name="isManager" value={person.isManager ? "false" : "true"} />
                      <Submit
                        className={quietButton}
                        aria-label={t(
                          person.isManager
                            ? "privateChannel.participants.unmakeManagerNamed"
                            : "privateChannel.participants.makeManagerNamed",
                          { name: person.displayName },
                        )}
                      >
                        {t(
                          person.isManager
                            ? "privateChannel.participants.unmakeManager"
                            : "privateChannel.participants.makeManager",
                        )}
                      </Submit>
                    </form>
                  ) : null}
                  <form action={removeAction}>
                    {hidden}
                    <input type="hidden" name="userId" value={person.userId} />
                    <Submit
                      className={quietButton}
                      aria-label={t("privateChannel.participants.removeNamed", { name: person.displayName })}
                    >
                      {t("privateChannel.participants.remove")}
                    </Submit>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <div>
            <p className="label mb-2">{t("privateChannel.participants.addHeading")}</p>
            <PrivateChannelParticipantSearch
              inputId="private-channel-add-search"
              localGroupId={localGroup.id}
              localGroupName={localGroup.name}
              channelId={channel.id}
              excludeIds={roster.map((person) => person.userId)}
              renderAction={(candidate) => (
                <form action={addAction}>
                  {hidden}
                  <input type="hidden" name="userId" value={candidate.userId} />
                  <Submit
                    className={quietButton}
                    aria-label={t("privateChannel.search.addNamed", { name: candidate.displayName })}
                  >
                    {t("privateChannel.search.add")}
                  </Submit>
                </form>
              )}
            />
          </div>

          {participantError?.status === "error" ? (
            <p role="alert" className="text-[13px] text-rust">
              {participantError.error}
            </p>
          ) : null}

          <p className="text-[12px] leading-relaxed text-ink-3">{t("privateChannel.participants.note")}</p>
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={closeDialog} className="h-9 rounded-[5px] px-3 text-sm text-ink-2 hover:bg-paper-2">
            {t("common.close")}
          </button>
        </div>
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "archive"} onClose={closeDialog} labelledBy="private-channel-archive-title">
        <h3 id="private-channel-archive-title" className="font-display text-lg leading-snug text-ink">
          {t(channel.archived ? "privateChannel.restore.title" : "privateChannel.archive.title", {
            name: channel.name,
          })}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {t(channel.archived ? "privateChannel.restore.body" : "privateChannel.archive.body")}
        </p>
        {archiveState.status === "error" ? (
          <p role="alert" className="mt-3 text-[13px] text-rust">
            {archiveState.error}
          </p>
        ) : null}
        <form action={archiveAction} className="mt-5 flex flex-wrap justify-end gap-2">
          {hidden}
          <input type="hidden" name="archived" value={channel.archived ? "false" : "true"} />
          <button type="button" onClick={closeDialog} className="h-9 rounded-[5px] px-3 text-sm text-ink-2 hover:bg-paper-2">
            {t("common.cancel")}
          </button>
          <Submit
            className="h-9 rounded-[5px] px-4 text-sm font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: accent }}
          >
            {t(channel.archived ? "privateChannel.restore.confirm" : "privateChannel.archive.confirm")}
          </Submit>
        </form>
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "delete"} onClose={closeDialog} labelledBy="private-channel-delete-title">
        <h3 id="private-channel-delete-title" className="font-display text-lg leading-snug text-ink">
          {t("privateChannel.delete.title")}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {t("privateChannel.delete.body", { name: channel.name })}
        </p>
        {deleteState.status === "error" ? (
          <p role="alert" className="mt-3 text-[13px] text-rust">
            {deleteState.error}
          </p>
        ) : null}
        <form action={deleteAction} className="mt-5 flex flex-wrap justify-end gap-2">
          {hidden}
          <button type="button" onClick={closeDialog} className="h-9 rounded-[5px] px-3 text-sm text-ink-2 hover:bg-paper-2">
            {t("common.cancel")}
          </button>
          <Submit className="h-9 rounded-[5px] bg-rust px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40">
            {t("privateChannel.delete.confirm")}
          </Submit>
        </form>
      </ConfirmDialog>
    </>
  );
}
