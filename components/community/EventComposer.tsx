"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Panel } from "@/components/ui/primitives";
import { IconPlus } from "@/components/ui/icons";
import { createEventAction } from "@/app/actions";
import { emptyEventFormState } from "@/lib/event-form";
import { useT } from "@/lib/i18n/react";
import type { LocalGroup } from "@/lib/types";

function Save({ accent }: { accent: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
      style={{ backgroundColor: accent }}
    >
      {pending ? t("events.compose.creating") : t("events.compose.open")}
    </button>
  );
}

const field =
  "h-10 w-full rounded-[5px] border border-line-2 bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3";

/**
 * Creating an event, for administrators.
 *
 * Collapsed until asked for: the page is for reading what is coming up, and an
 * open form above that list would push it down for the one person in the
 * community who needs it.
 *
 * Date and the two times are separate inputs because that is how a person
 * thinks about an event; the action combines them. Every rule here is checked
 * again by `events_insert`, so this is about giving a sentence back rather
 * than being the thing that enforces it.
 */
export function EventComposer({
  communityId,
  communityName,
  accent,
  localGroups = [],
}: {
  communityId: string;
  communityName: string;
  accent: string;
  localGroups?: LocalGroup[];
}) {
  const t = useT();
  const [state, formAction] = useActionState(createEventAction, emptyEventFormState);
  const [open, setOpen] = useState(false);

  // A successful create closes the form; the new event is already in the list
  // behind it.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "ok") setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-6 inline-flex h-10 items-center gap-2 rounded-[5px] border border-line-2 px-4 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
      >
        <IconPlus size={15} />
        {t("events.compose.open")}
      </button>
    );
  }

  return (
    <Panel className="mb-6 p-5">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="communityId" value={communityId} />

        <div>
          <label htmlFor="event-title" className="label mb-1.5 block">
            {t("events.compose.title")}
          </label>
          <input id="event-title" name="title" maxLength={120} autoFocus className={field} />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="event-date" className="label mb-1.5 block">
              {t("events.compose.date")}
            </label>
            <input id="event-date" name="date" type="date" required className={field} />
          </div>
          <div>
            <label htmlFor="event-start" className="label mb-1.5 block">
              {t("events.compose.from")}
            </label>
            <input id="event-start" name="startTime" type="time" required className={field} />
          </div>
          <div>
            <label htmlFor="event-end" className="label mb-1.5 block">
              {t("events.compose.to")}
            </label>
            <input id="event-end" name="endTime" type="time" required className={field} />
          </div>
        </div>

        <div>
          <label htmlFor="event-location" className="label mb-1.5 block">
            {t("events.compose.location")}
          </label>
          <input id="event-location" name="location" maxLength={120} className={field} />
        </div>

        {localGroups.length > 0 ? (
          <div>
            <label htmlFor="event-local-group" className="label mb-1.5 block">
              {t("events.compose.visibility")}
            </label>
            <select id="event-local-group" name="localGroupId" className={field}>
              <option value="">{t("composer.wholeCommunity")}</option>
              {localGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
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
            rows={3}
            maxLength={4000}
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
              min={1}
              placeholder={t("events.compose.unlimited")}
              className={field}
            />
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 pt-6 text-[13px] leading-snug text-ink-2">
            <input type="checkbox" name="isPublic" className="mt-0.5" />
            <span>
              {t("events.compose.public", { name: communityName })}
            </span>
          </label>
        </div>

        {state.status === "error" ? (
          <p role="alert" className="text-[13px] text-rust">
            {state.error}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Save accent={accent} />
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
