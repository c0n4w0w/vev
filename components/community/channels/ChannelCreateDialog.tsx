"use client";

import { useActionState, useState } from "react";
import { createCommunityChannelAction } from "@/app/channel-actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconHash } from "@/components/ui/icons";
import { CHANNEL_NAME_MAX, CHANNEL_PURPOSE_MAX } from "@/lib/channel-edit-form";
import { emptyChannelManageFormState } from "@/lib/channel-management-form";
import { useT } from "@/lib/i18n/react";
import type { ChannelSection } from "@/lib/types";
import {
  CancelButton,
  FormError,
  SubmitButton,
  WriteAccessField,
  fieldClass,
  newCreationKey,
  type WriteAccess,
} from "./dialog-parts";

/**
 * "Opprett kanal": name, an optional description and, when the community has
 * sections, which one it goes under. On success the action opens the new
 * channel, and the sidebar already lists it.
 *
 * The form is mounted only while the dialog is open, so each opening starts
 * empty and carries a new creation key. Pressing the button twice, or
 * resubmitting after a dropped response, sends that same key, and
 * `create_community_channel()` answers with the channel the first request
 * made rather than a second one.
 */
export function ChannelCreateDialog({
  communityId,
  communityName,
  sections,
  defaultSectionId,
  accent,
  open,
  onClose,
}: {
  communityId: string;
  communityName: string;
  sections: ChannelSection[];
  defaultSectionId?: string;
  accent: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog open={open} onClose={onClose} labelledBy="channel-create-title">
      {open ? (
        <CreateForm
          communityId={communityId}
          communityName={communityName}
          sections={sections}
          defaultSectionId={defaultSectionId}
          accent={accent}
          onClose={onClose}
        />
      ) : null}
    </ConfirmDialog>
  );
}

function CreateForm({
  communityId,
  communityName,
  sections,
  defaultSectionId,
  accent,
  onClose,
}: {
  communityId: string;
  communityName: string;
  sections: ChannelSection[];
  defaultSectionId?: string;
  accent: string;
  onClose: () => void;
}) {
  const t = useT();
  const [state, formAction] = useActionState(createCommunityChannelAction, emptyChannelManageFormState);
  const [creationKey] = useState(newCreationKey);
  // Controlled, so a refused submission (a name already in use) keeps what
  // was typed: a form action resets uncontrolled fields.
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [sectionId, setSectionId] = useState(defaultSectionId ?? "");
  const [writeAccess, setWriteAccess] = useState<WriteAccess>("everyone");

  return (
    <>
      <h3 id="channel-create-title" className="flex items-center gap-2 font-display text-lg leading-snug text-ink">
        <IconHash size={16} className="shrink-0 text-ink-3" />
        {t("channels.create.title")}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        {t("channels.create.lead", { community: communityName })}
      </p>

      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="communityId" value={communityId} />
        <input type="hidden" name="creationKey" value={creationKey} />

        <div>
          <label htmlFor="channel-create-name" className="label mb-1 block">
            {t("channels.create.name")}
          </label>
          <input
            id="channel-create-name"
            name="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={CHANNEL_NAME_MAX}
            required
            autoComplete="off"
            autoFocus
            placeholder={t("channels.create.namePlaceholder")}
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor="channel-create-purpose" className="label mb-1 block">
            {t("channels.create.purpose")}{" "}
            <span className="font-normal normal-case tracking-normal text-ink-3">
              ({t("channels.create.optional")})
            </span>
          </label>
          <input
            id="channel-create-purpose"
            name="purpose"
            type="text"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            maxLength={CHANNEL_PURPOSE_MAX}
            autoComplete="off"
            placeholder={t("channels.create.purposePlaceholder")}
            className={fieldClass}
          />
        </div>

        {sections.length > 0 ? (
          <div>
            <label htmlFor="channel-create-section" className="label mb-1 block">
              {t("channels.create.section")}
            </label>
            <select
              id="channel-create-section"
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
        ) : null}

        <WriteAccessField idPrefix="channel-create-write" value={writeAccess} onChange={setWriteAccess} />

        <FormError state={state} />

        <div className="flex flex-wrap justify-end gap-2">
          <CancelButton onClick={onClose} />
          <SubmitButton
            label={t("channels.create.submit")}
            pendingLabel={t("channels.create.creating")}
            accent={accent}
          />
        </div>
      </form>
    </>
  );
}
