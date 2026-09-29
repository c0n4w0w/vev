"use client";

import {
  createEventAction,
  setEventImageAction,
  setEventOrganizersAction,
  updateEventAction,
} from "@/app/collaboration-workspace-actions";
import {
  WorkspaceForm,
  fieldClass,
  hintClass,
  labelClass,
} from "@/components/collaboration/workspace/WorkspaceForm";
import { IconLock } from "@/components/ui/icons";
import {
  EVENT_DESCRIPTION_MAX,
  EVENT_LOCATION_MAX,
  EVENT_NOTES_MAX,
  EVENT_TITLE_MAX,
  EVENT_URL_MAX,
} from "@/lib/collaboration-workspace-form";
import { useT } from "@/lib/i18n/react";
import type { WorkspaceEvent, WorkspaceEventAudience, WorkspaceEventStatus } from "@/lib/types";

const AUDIENCES: WorkspaceEventAudience[] = ["public", "participating_organizations", "invite_only"];
const STATUSES: WorkspaceEventStatus[] = ["draft", "confirmed", "cancelled"];

/**
 * The private plan. Fields that could one day be published and fields that
 * never will be are kept visibly apart: internal notes sit in their own
 * boxed section marked "always private", and no publishing code reads them.
 */
export function EventForm({
  collaborationId,
  slug,
  event,
  defaults,
}: {
  collaborationId: string;
  slug: string;
  event?: WorkspaceEvent;
  /** Oslo date/time parts of the saved start and end, for editing. */
  defaults?: { date: string; startTime: string; endTime: string };
}) {
  const t = useT();
  const id = event?.id ?? "new";

  return (
    <WorkspaceForm
      action={event ? updateEventAction : createEventAction}
      hidden={event ? { eventId: event.id, collaborationId, slug } : { collaborationId, slug }}
      submitLabel={event ? t("ws.events.save") : t("ws.events.create")}
    >
      <div>
        <label htmlFor={`event-title-${id}`} className={labelClass}>
          {t("ws.events.titleLabel")}
        </label>
        <input
          id={`event-title-${id}`}
          name="title"
          required
          maxLength={EVENT_TITLE_MAX}
          defaultValue={event?.title}
          className={`${fieldClass} h-10`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="min-w-0">
          <label htmlFor={`event-date-${id}`} className={labelClass}>
            {t("ws.events.date")}
          </label>
          <input id={`event-date-${id}`} name="date" type="date" defaultValue={defaults?.date} className={`${fieldClass} h-10`} />
        </div>
        <div className="min-w-0">
          <label htmlFor={`event-start-${id}`} className={labelClass}>
            {t("ws.events.start")}
          </label>
          <input id={`event-start-${id}`} name="startTime" type="time" defaultValue={defaults?.startTime} className={`${fieldClass} h-10`} />
        </div>
        <div className="min-w-0">
          <label htmlFor={`event-end-${id}`} className={labelClass}>
            {t("ws.events.end")}
          </label>
          <input id={`event-end-${id}`} name="endTime" type="time" defaultValue={defaults?.endTime} className={`${fieldClass} h-10`} />
        </div>
      </div>

      <div>
        <label htmlFor={`event-location-${id}`} className={labelClass}>
          {t("ws.events.location")}
        </label>
        <input
          id={`event-location-${id}`}
          name="location"
          maxLength={EVENT_LOCATION_MAX}
          defaultValue={event?.location}
          className={`${fieldClass} h-10`}
        />
      </div>

      <div>
        <label htmlFor={`event-description-${id}`} className={labelClass}>
          {t("ws.events.description")} <span className="font-normal text-ink-3">· {t("ws.events.descriptionHint")}</span>
        </label>
        <textarea
          id={`event-description-${id}`}
          name="description"
          rows={5}
          maxLength={EVENT_DESCRIPTION_MAX}
          defaultValue={event?.description}
          className={`${fieldClass} resize-y py-2 leading-relaxed`}
        />
      </div>

      <div>
        <label htmlFor={`event-url-${id}`} className={labelClass}>
          {t("ws.events.registration")}
        </label>
        <input
          id={`event-url-${id}`}
          name="registrationUrl"
          type="url"
          inputMode="url"
          maxLength={EVENT_URL_MAX}
          defaultValue={event?.registrationUrl}
          placeholder="https://"
          className={`${fieldClass} h-10`}
        />
        <p className={hintClass}>{t("ws.events.registrationHint")}</p>
      </div>

      <fieldset>
        <legend className={labelClass}>{t("ws.events.audienceLabel")}</legend>
        <div className="flex flex-wrap gap-2">
          {AUDIENCES.map((audience) => (
            <label
              key={audience}
              className="flex cursor-pointer items-center gap-2 rounded-[5px] border border-line bg-surface px-3 py-2 text-[13px] text-ink-2 has-[:checked]:border-skog/50 has-[:checked]:bg-skog-soft has-[:checked]:text-ink"
            >
              <input
                type="radio"
                name="audience"
                value={audience}
                aria-label={t(`ws.events.audience.${audience}`)}
                defaultChecked={(event?.audience ?? "public") === audience}
                className="accent-[var(--color-skog)]"
              />
              {t(`ws.events.audience.${audience}`)}
            </label>
          ))}
        </div>
        <p className={hintClass}>{t("ws.events.audienceHint")}</p>
      </fieldset>

      <div className="max-w-xs">
        <label htmlFor={`event-status-${id}`} className={labelClass}>
          {t("ws.events.statusLabel")}
        </label>
        <select
          id={`event-status-${id}`}
          name="status"
          defaultValue={event?.status ?? "draft"}
          className={`${fieldClass} h-10 pr-8`}
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`ws.events.status.${status}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-[6px] border border-dashed border-line-2 bg-paper-2/40 p-4">
        <label htmlFor={`event-notes-${id}`} className={`${labelClass} flex items-center gap-1.5`}>
          <IconLock size={13} className="text-ink-3" />
          {t("ws.events.notes")}
        </label>
        <textarea
          id={`event-notes-${id}`}
          name="internalNotes"
          rows={4}
          maxLength={EVENT_NOTES_MAX}
          defaultValue={event?.internalNotes}
          className={`${fieldClass} resize-y py-2 leading-relaxed`}
        />
        <p className={hintClass}>{t("ws.events.notesHint")}</p>
      </div>
    </WorkspaceForm>
  );
}

export interface OrganizerOption {
  participantId: string;
  label: string;
  /** The unit's own answer, as far as this event is concerned. */
  consent: "approved" | "pending" | "notAsked";
}

/**
 * Which participating units to ASK to name publicly. Saving publishes
 * nothing and approves nothing on another unit's behalf; each unit's own
 * answer is shown beside it.
 */
export function OrganizerPicker({
  eventId,
  slug,
  options,
  selected,
}: {
  eventId: string;
  slug: string;
  options: OrganizerOption[];
  selected: string[];
}) {
  const t = useT();
  const chosen = new Set(selected);
  return (
    <WorkspaceForm
      action={setEventOrganizersAction}
      hidden={{ eventId, slug }}
      submitLabel={t("ws.pub.organizersSave")}
      submitVariant="secondary"
    >
      <fieldset>
        <legend className={labelClass}>{t("ws.pub.organizers")}</legend>
        <div className="space-y-2">
          {options.map((option) => (
            <label key={option.participantId} className="flex cursor-pointer items-start gap-2.5 text-[13.5px] text-ink-2">
              <input
                type="checkbox"
                name="participantId"
                value={option.participantId}
                aria-label={option.label}
                defaultChecked={chosen.has(option.participantId)}
                className="mt-0.5 accent-[var(--color-skog)]"
              />
              <span className="min-w-0">
                <span className="block [overflow-wrap:anywhere]">{option.label}</span>
                <span
                  className={`block text-[12px] ${option.consent === "approved" ? "text-skog" : "text-ink-3"}`}
                >
                  {t(`ws.pub.consent.${option.consent}`)}
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className={hintClass}>{t("ws.pub.organizersHint")}</p>
      </fieldset>
    </WorkspaceForm>
  );
}

/** Which of the collaboration's own images to use publicly. Saving publishes nothing. */
export function ImagePicker({
  eventId,
  slug,
  images,
  selected,
}: {
  eventId: string;
  slug: string;
  images: { id: string; name: string }[];
  selected?: string;
}) {
  const t = useT();
  if (images.length === 0) {
    return (
      <div>
        <p className={labelClass}>{t("ws.pub.image")}</p>
        <p className="text-[12.5px] text-ink-3">{t("ws.pub.noImages")}</p>
      </div>
    );
  }
  return (
    <WorkspaceForm
      action={setEventImageAction}
      hidden={{ eventId, slug }}
      submitLabel={t("ws.pub.imageSave")}
      submitVariant="secondary"
    >
      <div>
        <label htmlFor={`event-image-${eventId}`} className={labelClass}>
          {t("ws.pub.image")}
        </label>
        <select id={`event-image-${eventId}`} name="fileId" defaultValue={selected ?? ""} className={`${fieldClass} h-10 pr-8`}>
          <option value="">{t("ws.pub.imageNone")}</option>
          {images.map((image) => (
            <option key={image.id} value={image.id}>
              {image.name}
            </option>
          ))}
        </select>
        <p className={hintClass}>{t("ws.pub.imageHint")}</p>
      </div>
    </WorkspaceForm>
  );
}
