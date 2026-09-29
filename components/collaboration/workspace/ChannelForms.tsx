"use client";

import { useState } from "react";
import {
  createChannelAction,
  setChannelStatusAction,
  updateChannelAction,
} from "@/app/collaboration-workspace-actions";
import { ActionButton } from "@/components/collaboration/ActionButton";
import {
  WorkspaceForm,
  fieldClass,
  hintClass,
  labelClass,
} from "@/components/collaboration/workspace/WorkspaceForm";
import { IconSettings } from "@/components/ui/icons";
import {
  CHANNEL_DESCRIPTION_MAX,
  CHANNEL_NAME_MAX,
  channelNamePreview,
} from "@/lib/collaboration-workspace-form";
import { useT } from "@/lib/i18n/react";
import type { WorkspaceChannel } from "@/lib/types";

/** Shown to workspace managers only; the database refuses everyone else. */
export function CreateChannelForm({ collaborationId, slug }: { collaborationId: string; slug: string }) {
  const t = useT();
  const [name, setName] = useState("");
  const preview = channelNamePreview(name);

  return (
    <WorkspaceForm
      action={createChannelAction}
      hidden={{ collaborationId, slug }}
      submitLabel={t("ws.channels.create")}
    >
      <div>
        <label htmlFor="channel-name" className={labelClass}>
          {t("ws.channels.name")}
        </label>
        <input
          id="channel-name"
          name="name"
          required
          maxLength={CHANNEL_NAME_MAX + 20}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("ws.channels.namePlaceholder")}
          className={`${fieldClass} h-10`}
          autoComplete="off"
        />
        <p className={hintClass}>{t("ws.channels.nameHint", { name: preview || "…" })}</p>
      </div>
      <div>
        <label htmlFor="channel-description" className={labelClass}>
          {t("ws.channels.description")}
        </label>
        <input
          id="channel-description"
          name="description"
          maxLength={CHANNEL_DESCRIPTION_MAX}
          className={`${fieldClass} h-10`}
        />
      </div>
    </WorkspaceForm>
  );
}

/**
 * Rename, describe, archive or reopen. The default channel cannot be
 * archived — the database refuses it, and the button is not offered.
 */
export function ChannelSettings({ channel, slug }: { channel: WorkspaceChannel; slug: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(channel.name);

  return (
    <div className="w-full sm:w-auto">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-[5px] px-2 text-[13px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
      >
        <IconSettings size={15} />
        {t("ws.channel.settings")}
      </button>
      {open ? (
        <div className="mt-3 w-full space-y-4 rounded-[6px] border border-line bg-paper/60 p-4 sm:w-[26rem]">
          <WorkspaceForm
            action={updateChannelAction}
            hidden={{ channelId: channel.id, slug }}
            submitLabel={t("ws.channel.save")}
            submitVariant="secondary"
          >
            <div>
              <label htmlFor="edit-channel-name" className={labelClass}>
                {t("ws.channels.name")}
              </label>
              <input
                id="edit-channel-name"
                name="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={`${fieldClass} h-10`}
                autoComplete="off"
              />
              <p className={hintClass}>{t("ws.channels.nameHint", { name: channelNamePreview(name) || "…" })}</p>
            </div>
            <div>
              <label htmlFor="edit-channel-description" className={labelClass}>
                {t("ws.channels.description")}
              </label>
              <input
                id="edit-channel-description"
                name="description"
                defaultValue={channel.description ?? ""}
                maxLength={CHANNEL_DESCRIPTION_MAX}
                className={`${fieldClass} h-10`}
              />
            </div>
          </WorkspaceForm>

          <div className="border-t border-line pt-4">
            {channel.isDefault ? (
              <p className="text-[12.5px] text-ink-3">{t("ws.channel.defaultNote")}</p>
            ) : channel.status === "active" ? (
              <ActionButton
                action={setChannelStatusAction}
                fields={{ channelId: channel.id, status: "archived", slug }}
                label={t("ws.channel.archive")}
                variant="quiet"
                confirm={{ note: t("ws.channel.archiveNote"), yes: t("ws.channel.archiveConfirm") }}
              />
            ) : (
              <ActionButton
                action={setChannelStatusAction}
                fields={{ channelId: channel.id, status: "active", slug }}
                label={t("ws.channel.restore")}
                variant="secondary"
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
