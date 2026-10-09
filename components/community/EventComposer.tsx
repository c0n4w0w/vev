"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Panel } from "@/components/ui/primitives";
import { IconPlus } from "@/components/ui/icons";
import { createEventAction, updateEventAction } from "@/app/actions";
import { emptyEventFormState } from "@/lib/event-form";
import { osloInputParts } from "@/lib/format";
import { useT } from "@/lib/i18n/react";
import { ScopeOptions } from "@/components/community/ScopeOptions";
import type { LocalGroup, Subgroup } from "@/lib/types";

function Save({ accent, editing }: { accent: string; editing: boolean }) {
  const { pending } = useFormStatus();
  const t = useT();
  const label = editing ? t("events.compose.saveChanges") : t("events.compose.open");
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
      style={{ backgroundColor: accent }}
    >
      {pending ? (editing ? t("common.saving") : t("events.compose.creating")) : label}
    </button>
  );
}

const field =
  "h-10 w-full rounded-[5px] border border-line-2 bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3";

/** What the edit form needs to know about the event it changes. */
export type EditableEvent = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location: string;
  capacity?: number;
  /** Current RSVPs — the lowest capacity the edit may set. */
  attendeeCount: number;
  /** "Kun for medlemmer", "Åpent arrangement" or the lokallag/group name. */
  scopeLabel: string;
};

type Draft = {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  endDate: string;
  location: string;
  description: string;
  capacity: string;
};

const blankDraft: Draft = {
  title: "",
  date: "",
  startTime: "",
  endTime: "",
  endDate: "",
  location: "",
  description: "",
  capacity: "",
};

function draftFrom(event: EditableEvent): Draft {
  const start = osloInputParts(event.startsAt);
  const end = osloInputParts(event.endsAt);
  return {
    title: event.title,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    endDate: end.date,
    location: event.location,
    description: event.description,
    capacity: event.capacity ? String(event.capacity) : "",
  };
}

/**
 * Creating an event, for administrators — and, with `lockedLocalGroup`, for a
 * lokallagsleder on their own lokallag's page. With `event`, the same form
 * edits that event instead.
 *
 * Locked, the audience is fixed to that one lokallag: there is no scope
 * select and no "public" option (a lokallag event is never public), only a
 * hidden field. That is presentation; `events_insert` refuses a lokallagsleder
 * any other scope whatever the form sends.
 *
 * Editing changes title, description, time, place and capacity — nothing
 * else. The scope and visibility are shown but not offered, and the form
 * carries no community or host. Who may edit is `events_update`'s decision.
 * In edit mode the form has no trigger of its own: the event page's
 * "Administrer" menu opens it by changing `openRequest`.
 *
 * Collapsed until asked for: the page is for reading what is coming up, and an
 * open form above that list would push it down for the one person in the
 * community who needs it.
 *
 * Date and the two times are separate inputs because that is how a person
 * thinks about an event; the action combines them. Every rule here is checked
 * again by the database, so this is about giving a sentence back rather than
 * being the thing that enforces it. The fields are controlled so a refused
 * save never loses what was typed.
 */
export function EventComposer({
  communityId,
  communityName,
  accent,
  localGroups = [],
  subgroups = [],
  lockedLocalGroup,
  event,
  openRequest = 0,
}: {
  communityId: string;
  communityName: string;
  accent: string;
  localGroups?: LocalGroup[];
  subgroups?: Subgroup[];
  lockedLocalGroup?: Pick<LocalGroup, "id" | "name">;
  event?: EditableEvent;
  /** Edit mode: each new value opens the form, starting from the stored event. */
  openRequest?: number;
}) {
  const t = useT();
  const editing = Boolean(event);
  const [state, formAction] = useActionState(
    editing ? updateEventAction : createEventAction,
    emptyEventFormState,
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(event ? draftFrom(event) : blankDraft);
  const [scope, setScope] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const set = (key: keyof Draft) => (e: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: e.target.value }));

  // A successful save closes the form; the page behind it already shows the
  // result.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "ok") setOpen(false);
  }

  function openForm() {
    // Start from what is stored now, not from a previous attempt.
    setDraft(event ? draftFrom(event) : blankDraft);
    setScope("");
    setIsPublic(false);
    setOpen(true);
  }

  // Opened from outside (the event page's menu), adjusted during render like
  // the success handling above.
  const [seenRequest, setSeenRequest] = useState(openRequest);
  if (openRequest !== seenRequest) {
    setSeenRequest(openRequest);
    if (event) {
      setDraft(draftFrom(event));
      setOpen(true);
    }
  }

  // An event that already spans more than one day keeps its own end date; the
  // composer's single-day shape would otherwise fold it into one.
  // Decided by the stored event, not the draft, so changing the date of a
  // one-day event never makes an end-date field appear.
  const multiDay = event
    ? osloInputParts(event.startsAt).date !== osloInputParts(event.endsAt).date
    : false;
  const minimumCapacity = Math.max(1, event?.attendeeCount ?? 0);

  if (!open) {
    if (editing) return null;
    return (
      <button
        type="button"
        onClick={openForm}
        className="mb-6 inline-flex h-10 items-center gap-2 rounded-[5px] border border-line-2 px-4 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
      >
        <IconPlus size={15} />
        {t("events.compose.open")}
      </button>
    );
  }

  return (
    <Panel className={editing ? "mt-3 p-5" : "mb-6 p-5"}>
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="communityId" value={communityId} />
        {event ? <input type="hidden" name="eventId" value={event.id} /> : null}
        {editing ? <p className="label">{t("events.compose.editTitle")}</p> : null}

        <div>
          <label htmlFor="event-title" className="label mb-1.5 block">
            {t("events.compose.title")}
          </label>
          <input
            id="event-title"
            name="title"
            maxLength={120}
            autoFocus
            value={draft.title}
            onChange={set("title")}
            className={field}
          />
        </div>

        <div className={multiDay ? "grid gap-3 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-3"}>
          <div>
            <label htmlFor="event-date" className="label mb-1.5 block">
              {t("events.compose.date")}
            </label>
            <input id="event-date" name="date" type="date" required value={draft.date} onChange={set("date")} className={field} />
          </div>
          <div>
            <label htmlFor="event-start" className="label mb-1.5 block">
              {t("events.compose.from")}
            </label>
            <input id="event-start" name="startTime" type="time" required value={draft.startTime} onChange={set("startTime")} className={field} />
          </div>
          {multiDay ? (
            <div>
              <label htmlFor="event-end-date" className="label mb-1.5 block">
                {t("events.compose.endDate")}
              </label>
              <input id="event-end-date" name="endDate" type="date" required value={draft.endDate} onChange={set("endDate")} className={field} />
            </div>
          ) : null}
          <div>
            <label htmlFor="event-end" className="label mb-1.5 block">
              {t("events.compose.to")}
            </label>
            <input id="event-end" name="endTime" type="time" required value={draft.endTime} onChange={set("endTime")} className={field} />
          </div>
        </div>

        <div>
          <label htmlFor="event-location" className="label mb-1.5 block">
            {t("events.compose.location")}
          </label>
          <input id="event-location" name="location" maxLength={120} value={draft.location} onChange={set("location")} className={field} />
        </div>

        {event ? (
          <div>
            <p className="label mb-1.5">{t("events.compose.visibility")}</p>
            <p className="text-[13px] text-ink-2">
              {t("events.compose.scopeFixed", { scope: event.scopeLabel })}
            </p>
          </div>
        ) : lockedLocalGroup ? (
          <div>
            <input type="hidden" name="scope" value={`local:${lockedLocalGroup.id}`} />
            <p className="label mb-1.5">{t("events.compose.visibility")}</p>
            <p className="text-[13px] text-ink-2">
              {t("events.compose.lockedScope", { name: lockedLocalGroup.name })}
            </p>
          </div>
        ) : localGroups.length + subgroups.length > 0 ? (
          <div>
            <label htmlFor="event-local-group" className="label mb-1.5 block">
              {t("events.compose.visibility")}
            </label>
            <select
              id="event-local-group"
              name="scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className={field}
            >
              <ScopeOptions localGroups={localGroups} subgroups={subgroups} />
            </select>
          </div>
        ) : null}

        <div>
          <label htmlFor="event-description" className="label mb-1.5 block">
            {t("events.compose.description")}
          </label>
          <textarea
            id="event-description"
            name="description"
            rows={editing ? 5 : 3}
            maxLength={4000}
            value={draft.description}
            onChange={set("description")}
            className="w-full rounded-[5px] border border-line-2 bg-surface px-3 py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="event-capacity" className="label mb-1.5 block">
              {t("events.compose.capacity")}
            </label>
            <input
              id="event-capacity"
              name="capacity"
              type="number"
              min={minimumCapacity}
              placeholder={t("events.compose.unlimited")}
              value={draft.capacity}
              onChange={set("capacity")}
              aria-describedby={event && event.attendeeCount > 0 ? "event-capacity-min" : undefined}
              className={field}
            />
            {event && event.attendeeCount > 0 ? (
              <p id="event-capacity-min" className="mt-1.5 text-[12px] text-ink-3">
                {t("events.compose.capacityMin", { count: event.attendeeCount })}
              </p>
            ) : null}
          </div>
          {editing || lockedLocalGroup ? null : (
            <label className="flex cursor-pointer items-start gap-2.5 pt-6 text-[13px] leading-snug text-ink-2">
              <input
                type="checkbox"
                name="isPublic"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                {t("events.compose.public", { name: communityName })}
              </span>
            </label>
          )}
        </div>

        {state.status === "error" ? (
          <p role="alert" className="text-[13px] text-rust">
            {state.error}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Save accent={accent} editing={editing} />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-10 rounded-[5px] px-3 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Panel>
  );
}
