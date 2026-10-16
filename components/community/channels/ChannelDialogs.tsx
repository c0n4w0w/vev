"use client";

import { useActionState, useState } from "react";
import {
  deleteCommunityChannelAction,
  updateCommunityChannelAction,
  moveCommunityChannelAction,
  setCommunityChannelArchivedAction,
} from "@/app/channel-actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CHANNEL_NAME_MAX, CHANNEL_PURPOSE_MAX } from "@/lib/channel-edit-form";
import { emptyChannelManageFormState } from "@/lib/channel-management-form";
import { tn } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/react";
import type { Channel, ChannelContentCounts, ChannelSection } from "@/lib/types";
import {
  CancelButton,
  FileSharingField,
  FormError,
  SubmitButton,
  WriteAccessField,
  fieldClass,
  useCloseOnSuccess,
  type WriteAccess,
} from "./dialog-parts";

/**
 * The dialogs behind an administrator's channel actions, shared by a channel's
 * own "Administrer kanal" menu and the Kanaler page. Each form is mounted only
 * while its dialog is open, so it starts from the channel as it is now and
 * forgets an earlier error. Every one of them is decided again by a function
 * in the database that checks the caller administers the channel's community.
 */

type DialogProps = {
  communityId: string;
  channel: Channel;
  accent: string;
  open: boolean;
  onClose: () => void;
};

function Hidden({ communityId, channelId }: { communityId: string; channelId: string }) {
  return (
    <>
      <input type="hidden" name="communityId" value={communityId} />
      <input type="hidden" name="channelId" value={channelId} />
    </>
  );
}

// ── Name, description, who may write and file sharing ───────────────────

export function ChannelEditDialog(props: DialogProps) {
  return (
    <ConfirmDialog open={props.open} onClose={props.onClose} labelledBy={`channel-edit-${props.channel.id}`}>
      {props.open ? <EditForm {...props} /> : null}
    </ConfirmDialog>
  );
}

function EditForm({ communityId, channel, accent, onClose }: DialogProps) {
  const t = useT();
  const [state, formAction] = useActionState(updateCommunityChannelAction, emptyChannelManageFormState);
  const [name, setName] = useState(channel.name);
  const [purpose, setPurpose] = useState(channel.purpose);
  const [writeAccess, setWriteAccess] = useState<WriteAccess>(channel.readOnly ? "staff" : "everyone");
  const [fileSharing, setFileSharing] = useState(Boolean(channel.fileSharing));
  useCloseOnSuccess(state, onClose);

  return (
    <>
      <h3 id={`channel-edit-${channel.id}`} className="font-display text-lg leading-snug text-ink">
        {t("channels.edit.title", { name: channel.name })}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{t("channels.edit.lead")}</p>
      <form action={formAction} className="mt-4 space-y-4">
        <Hidden communityId={communityId} channelId={channel.id} />
        <div>
          <label htmlFor={`channel-edit-name-${channel.id}`} className="label mb-1 block">
            {t("channels.create.name")}
          </label>
          <input
            id={`channel-edit-name-${channel.id}`}
            name="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            maxLength={CHANNEL_NAME_MAX}
            required
            autoComplete="off"
            autoFocus
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={`channel-edit-purpose-${channel.id}`} className="label mb-1 block">
            {t("channels.create.purpose")}{" "}
            <span className="font-normal normal-case tracking-normal text-ink-3">
              ({t("channels.create.optional")})
            </span>
          </label>
          <input
            id={`channel-edit-purpose-${channel.id}`}
            name="purpose"
            type="text"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            maxLength={CHANNEL_PURPOSE_MAX}
            autoComplete="off"
            className={fieldClass}
          />
        </div>
        <WriteAccessField idPrefix={`channel-edit-write-${channel.id}`} value={writeAccess} onChange={setWriteAccess} />
        <FileSharingField
          id={`channel-edit-files-${channel.id}`}
          checked={fileSharing}
          onChange={setFileSharing}
          keepNote={Boolean(channel.fileSharing) && !fileSharing}
        />
        <FormError state={state} />
        <div className="flex flex-wrap justify-end gap-2">
          <CancelButton onClick={onClose} />
          <SubmitButton label={t("common.save")} pendingLabel={t("common.saving")} accent={accent} />
        </div>
      </form>
    </>
  );
}

// ── Section ─────────────────────────────────────────────────────────────

export function ChannelMoveDialog(props: DialogProps & { sections: ChannelSection[] }) {
  return (
    <ConfirmDialog open={props.open} onClose={props.onClose} labelledBy={`channel-move-${props.channel.id}`}>
      {props.open ? <MoveForm {...props} /> : null}
    </ConfirmDialog>
  );
}

function MoveForm({ communityId, channel, sections, accent, onClose }: DialogProps & { sections: ChannelSection[] }) {
  const t = useT();
  const [state, formAction] = useActionState(moveCommunityChannelAction, emptyChannelManageFormState);
  const [sectionId, setSectionId] = useState(channel.sectionId ?? "");
  useCloseOnSuccess(state, onClose);

  return (
    <>
      <h3 id={`channel-move-${channel.id}`} className="font-display text-lg leading-snug text-ink">
        {t("channels.move.title", { name: channel.name })}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{t("channels.move.lead")}</p>
      <form action={formAction} className="mt-4 space-y-4">
        <Hidden communityId={communityId} channelId={channel.id} />
        <div>
          <label htmlFor={`channel-move-section-${channel.id}`} className="label mb-1 block">
            {t("channels.create.section")}
          </label>
          <select
            id={`channel-move-section-${channel.id}`}
            name="sectionId"
            value={sectionId}
            onChange={(event) => setSectionId(event.target.value)}
            className={fieldClass}
          >
            <option value="">{t("channels.create.noSection")}</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
        </div>
        <FormError state={state} />
        <div className="flex flex-wrap justify-end gap-2">
          <CancelButton onClick={onClose} />
          <SubmitButton label={t("channels.move.submit")} accent={accent} />
        </div>
      </form>
    </>
  );
}

// ── Archive and restore ─────────────────────────────────────────────────

export function ChannelArchiveDialog(props: DialogProps) {
  return (
    <ConfirmDialog open={props.open} onClose={props.onClose} labelledBy={`channel-archive-${props.channel.id}`}>
      {props.open ? <ArchiveForm {...props} /> : null}
    </ConfirmDialog>
  );
}

function ArchiveForm({ communityId, channel, accent, onClose }: DialogProps) {
  const t = useT();
  const [state, formAction] = useActionState(setCommunityChannelArchivedAction, emptyChannelManageFormState);
  useCloseOnSuccess(state, onClose);
  const restoring = Boolean(channel.archived);

  return (
    <>
      <h3 id={`channel-archive-${channel.id}`} className="font-display text-lg leading-snug text-ink">
        {t(restoring ? "channels.restore.title" : "channels.archive.title", { name: channel.name })}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        {t(restoring ? "channels.restore.body" : "channels.archive.body")}
      </p>
      <form action={formAction} className="mt-5 space-y-3">
        <Hidden communityId={communityId} channelId={channel.id} />
        <input type="hidden" name="archived" value={restoring ? "false" : "true"} />
        <FormError state={state} />
        <div className="flex flex-wrap justify-end gap-2">
          <CancelButton onClick={onClose} />
          <SubmitButton
            label={t(restoring ? "channels.restore.confirm" : "channels.archive.confirm")}
            accent={accent}
          />
        </div>
      </form>
    </>
  );
}

// ── Permanent deletion ──────────────────────────────────────────────────

/**
 * Says exactly what goes with the channel, from counts the database gave the
 * page. An empty channel is deleted with one more click. A channel with
 * messages also needs its name typed: the button stays disabled until it
 * matches, and the name travels with the request because
 * `delete_community_channel()` checks it again — so if messages arrived after
 * the counts were read, the database refuses and the field appears.
 */
export function ChannelDeleteDialog(
  props: DialogProps & {
    counts?: ChannelContentCounts;
    /** Where to land afterwards: the Kanaler page, or the community's Overview. */
    returnTo?: "manage";
  },
) {
  return (
    <ConfirmDialog open={props.open} onClose={props.onClose} labelledBy={`channel-delete-${props.channel.id}`}>
      {props.open ? <DeleteForm {...props} /> : null}
    </ConfirmDialog>
  );
}

function DeleteForm({
  communityId,
  channel,
  counts,
  returnTo,
  onClose,
}: DialogProps & { counts?: ChannelContentCounts; returnTo?: "manage" }) {
  const t = useT();
  const locale = useLocale();
  const [state, formAction] = useActionState(deleteCommunityChannelAction, emptyChannelManageFormState);
  const [typed, setTyped] = useState("");
  // Unknown counts are treated as "has content": the stricter form.
  const hasContent =
    !counts ||
    counts.messages > 0 ||
    counts.attachments > 0 ||
    counts.links > 0 ||
    counts.folders > 0 ||
    state.status === "error";
  const confirmed = !hasContent || typed.trim() === channel.name;

  return (
    <>
      <h3 id={`channel-delete-${channel.id}`} className="font-display text-lg leading-snug text-ink">
        {t("channels.delete.title", { name: channel.name })}
      </h3>
      {hasContent ? (
        <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-ink-2">
          <p>{t("channels.delete.contentBody")}</p>
          {counts ? (
            <ul className="list-disc space-y-0.5 pl-5">
              <li>{tn(locale, "count.messages", counts.messages)}</li>
              {counts.messages > 0 ? <li>{t("channels.delete.reactions")}</li> : null}
              {counts.attachments > 0 ? <li>{tn(locale, "count.attachments", counts.attachments)}</li> : null}
              {counts.links > 0 ? <li>{tn(locale, "count.links", counts.links)}</li> : null}
              {counts.folders > 0 ? <li>{tn(locale, "count.folders", counts.folders)}</li> : null}
            </ul>
          ) : null}
          <p className="text-ink-3">{t("channels.delete.untouched")}</p>
          {!channel.archived ? <p className="text-ink-3">{t("channels.delete.archiveHint")}</p> : null}
        </div>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{t("channels.delete.emptyBody")}</p>
      )}

      <form action={formAction} className="mt-4 space-y-3">
        <Hidden communityId={communityId} channelId={channel.id} />
        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
        {hasContent ? (
          <div>
            <label htmlFor={`channel-delete-confirm-${channel.id}`} className="mb-1 block text-[13px] text-ink-2">
              {t("channels.delete.confirmLabel", { name: channel.name })}
            </label>
            <input
              id={`channel-delete-confirm-${channel.id}`}
              name="confirmName"
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={fieldClass}
            />
          </div>
        ) : (
          <input type="hidden" name="confirmName" value="" />
        )}
        <FormError state={state} />
        <div className="flex flex-wrap justify-end gap-2">
          <CancelButton onClick={onClose} />
          <SubmitButton label={t("channels.delete.confirm")} danger disabled={!confirmed} />
        </div>
      </form>
    </>
  );
}
