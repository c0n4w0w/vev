"use client";

import { useActionState, useState } from "react";
import {
  createChannelSectionAction,
  deleteChannelSectionAction,
  renameChannelSectionAction,
} from "@/app/channel-actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SECTION_NAME_MAX, emptyChannelManageFormState } from "@/lib/channel-management-form";
import { tn } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/react";
import type { ChannelSection } from "@/lib/types";
import { CancelButton, FormError, SubmitButton, fieldClass, newCreationKey, useCloseOnSuccess } from "./dialog-parts";

/**
 * Creating, renaming and deleting a community's channel sections. Like the
 * channel dialogs, each form is mounted only while open, and every action is
 * decided again by a function that checks the caller administers the
 * section's community.
 */

export function SectionCreateDialog({
  communityId,
  accent,
  open,
  onClose,
}: {
  communityId: string;
  accent: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog open={open} onClose={onClose} labelledBy="section-create-title">
      {open ? <CreateForm communityId={communityId} accent={accent} onClose={onClose} /> : null}
    </ConfirmDialog>
  );
}

function CreateForm({ communityId, accent, onClose }: { communityId: string; accent: string; onClose: () => void }) {
  const t = useT();
  const [state, formAction] = useActionState(createChannelSectionAction, emptyChannelManageFormState);
  const [creationKey] = useState(newCreationKey);
  const [name, setName] = useState("");
  useCloseOnSuccess(state, onClose);

  return (
    <>
      <h3 id="section-create-title" className="font-display text-lg leading-snug text-ink">
        {t("sections.create.title")}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{t("sections.create.lead")}</p>
      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="communityId" value={communityId} />
        <input type="hidden" name="creationKey" value={creationKey} />
        <div>
          <label htmlFor="section-create-name" className="label mb-1 block">
            {t("sections.name")}
          </label>
          <input
            id="section-create-name"
            name="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={SECTION_NAME_MAX}
            required
            autoComplete="off"
            autoFocus
            placeholder={t("sections.create.namePlaceholder")}
            className={fieldClass}
          />
        </div>
        <FormError state={state} />
        <div className="flex flex-wrap justify-end gap-2">
          <CancelButton onClick={onClose} />
          <SubmitButton label={t("sections.create.submit")} accent={accent} />
        </div>
      </form>
    </>
  );
}

type SectionDialogProps = {
  communityId: string;
  section: ChannelSection;
  accent: string;
  open: boolean;
  onClose: () => void;
};

export function SectionRenameDialog(props: SectionDialogProps) {
  return (
    <ConfirmDialog open={props.open} onClose={props.onClose} labelledBy={`section-rename-${props.section.id}`}>
      {props.open ? <RenameForm {...props} /> : null}
    </ConfirmDialog>
  );
}

function RenameForm({ communityId, section, accent, onClose }: SectionDialogProps) {
  const t = useT();
  const [state, formAction] = useActionState(renameChannelSectionAction, emptyChannelManageFormState);
  const [name, setName] = useState(section.name);
  useCloseOnSuccess(state, onClose);

  return (
    <>
      <h3 id={`section-rename-${section.id}`} className="font-display text-lg leading-snug text-ink">
        {t("sections.rename.title", { name: section.name })}
      </h3>
      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="communityId" value={communityId} />
        <input type="hidden" name="sectionId" value={section.id} />
        <div>
          <label htmlFor={`section-rename-name-${section.id}`} className="label mb-1 block">
            {t("sections.name")}
          </label>
          <input
            id={`section-rename-name-${section.id}`}
            name="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            // Renaming usually replaces the name: start with it selected.
            onFocus={(event) => event.currentTarget.select()}
            maxLength={SECTION_NAME_MAX}
            required
            autoComplete="off"
            autoFocus
            className={fieldClass}
          />
        </div>
        <FormError state={state} />
        <div className="flex flex-wrap justify-end gap-2">
          <CancelButton onClick={onClose} />
          <SubmitButton label={t("common.save")} pendingLabel={t("common.saving")} accent={accent} />
        </div>
      </form>
    </>
  );
}

/**
 * An empty section is deleted with one click. A section with channels asks
 * where they go — no section, or another section — with nothing chosen in
 * advance, and the button waits for a choice. Its channels are never deleted
 * with it.
 */
export function SectionDeleteDialog(
  props: SectionDialogProps & { channelCount: number; otherSections: ChannelSection[] },
) {
  return (
    <ConfirmDialog open={props.open} onClose={props.onClose} labelledBy={`section-delete-${props.section.id}`}>
      {props.open ? <DeleteForm {...props} /> : null}
    </ConfirmDialog>
  );
}

function DeleteForm({
  communityId,
  section,
  channelCount,
  otherSections,
  onClose,
}: SectionDialogProps & { channelCount: number; otherSections: ChannelSection[] }) {
  const t = useT();
  const locale = useLocale();
  const [state, formAction] = useActionState(deleteChannelSectionAction, emptyChannelManageFormState);
  const [destination, setDestination] = useState<string | null>(null);
  useCloseOnSuccess(state, onClose);
  const hasChannels = channelCount > 0;

  return (
    <>
      <h3 id={`section-delete-${section.id}`} className="font-display text-lg leading-snug text-ink">
        {t("sections.delete.title", { name: section.name })}
      </h3>
      <form action={formAction} className="mt-2 space-y-4">
        <input type="hidden" name="communityId" value={communityId} />
        <input type="hidden" name="sectionId" value={section.id} />
        {hasChannels ? (
          <fieldset>
            <legend className="text-[13px] leading-relaxed text-ink-2">
              {t("sections.delete.channelsBody", { channels: tn(locale, "count.channels", channelCount) })}
            </legend>
            <div className="mt-3 space-y-1.5">
              {[
                { value: "none", label: t("sections.delete.toNone") },
                ...otherSections.map((other) => ({
                  value: other.id,
                  label: t("sections.delete.toSection", { name: other.name }),
                })),
              ].map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2.5 rounded-[5px] border border-line px-3 py-2 text-sm text-ink has-[:checked]:border-ink-3"
                >
                  <input
                    type="radio"
                    name="channelsTo"
                    value={option.value}
                    checked={destination === option.value}
                    onChange={() => setDestination(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="text-[13px] leading-relaxed text-ink-2">{t("sections.delete.emptyBody")}</p>
        )}
        <FormError state={state} />
        <div className="flex flex-wrap justify-end gap-2">
          <CancelButton onClick={onClose} />
          <SubmitButton label={t("sections.delete.confirm")} danger disabled={hasChannels && destination === null} />
        </div>
      </form>
    </>
  );
}
