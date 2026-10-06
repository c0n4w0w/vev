"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { updateChannelDetailsAction } from "@/app/actions";
import { IconPencil } from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";
import {
  CHANNEL_NAME_MAX,
  CHANNEL_PURPOSE_MAX,
  emptyChannelEditFormState,
} from "@/lib/channel-edit-form";
import { useT } from "@/lib/i18n/react";
import type { Channel } from "@/lib/types";

function SaveButton({ accent }: { accent: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-8 rounded-[5px] px-3 text-[13px] font-medium text-white transition-opacity disabled:opacity-40"
      style={{ backgroundColor: accent }}
    >
      {pending ? t("common.saving") : t("common.save")}
    </button>
  );
}

const fieldClass =
  "h-8 w-full rounded-[5px] border border-line-2 bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-ink-3";

/**
 * The "Dette er starten på #kanal" banner at the top of a channel.
 *
 * Read mode is the banner every member sees. For an admin it also carries a
 * quiet pencil, and clicking it turns this same card into the editor — there
 * is no second form. `canEdit` is presentation only: the write goes through
 * `updateChannelDetailsAction`, which asks the database whether the caller is
 * an active admin of this community. Drafts live in state, so a failed save
 * loses nothing.
 */
export function ChannelIntroCard({
  communityId,
  audienceNote,
  channel,
  canEdit,
  accent,
}: {
  communityId: string;
  /** One sentence saying who can read the conversation. */
  audienceNote: string;
  channel: Channel;
  canEdit: boolean;
  accent: string;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(channel.name);
  const [purpose, setPurpose] = useState(channel.purpose);
  const [state, formAction] = useActionState(updateChannelDetailsAction, emptyChannelEditFormState);

  // Close once the save is confirmed; the revalidation brings the new values
  // in through `channel`.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "ok") setEditing(false);
  }

  function startEditing() {
    setName(channel.name);
    setPurpose(channel.purpose);
    setEditing(true);
  }

  function cancelEditing() {
    setName(channel.name);
    setPurpose(channel.purpose);
    setEditing(false);
  }

  return (
    <div
      className="relative mb-8 rounded-[6px] border border-line p-5"
      style={{ backgroundColor: `${accent}0a` }}
    >
      {editing ? (
        <form action={formAction}>
          <input type="hidden" name="communityId" value={communityId} />
          <input type="hidden" name="channelId" value={channel.id} />
          <div className="space-y-3">
            <div>
              <label htmlFor="channel-name" className="label mb-1 block">
                {t("channel.nameLabel")}
              </label>
              <input
                id="channel-name"
                name="name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={CHANNEL_NAME_MAX}
                required
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Escape") cancelEditing();
                }}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="channel-purpose" className="label mb-1 block">
                {t("channel.purposeLabel")}
              </label>
              <input
                id="channel-purpose"
                name="purpose"
                type="text"
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                maxLength={CHANNEL_PURPOSE_MAX}
                onKeyDown={(event) => {
                  if (event.key === "Escape") cancelEditing();
                }}
                className={fieldClass}
              />
            </div>
          </div>
          {state.status === "error" ? (
            <p role="alert" className="mt-2 text-[12px] text-rust">
              {state.message}
            </p>
          ) : null}
          <div className="mt-3 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={cancelEditing}
              className="h-8 rounded-[5px] px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
            >
              {t("common.cancel")}
            </button>
            <SaveButton accent={accent} />
          </div>
        </form>
      ) : (
        <>
          {canEdit ? (
            <button
              type="button"
              onClick={startEditing}
              aria-label={t("channel.edit")}
              title={t("channel.edit")}
              className={cn(
                "absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-[5px]",
                "text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink focus-visible:bg-paper-2 focus-visible:text-ink",
              )}
            >
              <IconPencil size={15} />
            </button>
          ) : null}
          <h2 className={cn("font-display text-lg text-ink", canEdit && "pr-9")}>
            {t("channel.start", { name: channel.name })}
          </h2>
          <p className={cn("mt-1.5 text-sm leading-relaxed text-ink-2", canEdit && "pr-9")}>
            {channel.purpose}
          </p>
          <p className="mt-3 text-xs text-ink-3">
            {audienceNote}
          </p>
        </>
      )}
    </div>
  );
}
