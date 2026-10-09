"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { removeEventAttendeeAction } from "@/app/actions";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconMore, IconUserMinus } from "@/components/ui/icons";
import { Avatar, cn } from "@/components/ui/primitives";
import { emptyEventLifecycleFormState } from "@/lib/event-form";
import { useT } from "@/lib/i18n/react";
import type { EventAttendee } from "@/lib/types";

function RemoveButton({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-9 rounded-[5px] bg-rust px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
    >
      {pending ? "…" : children}
    </button>
  );
}

/**
 * The private "Påmeldte" list on an event page.
 *
 * Only rendered for people who may see the roster. With `canRemove` — someone
 * who may manage this scheduled, upcoming event — each row gets a small
 * three-dot menu with "Fjern påmelding", behind a confirmation. That is
 * presentation: remove_event_attendee decides, from auth.uid(), whether the
 * removal happens. Without it the list is exactly the plain roster.
 *
 * The rows come from the server, so after a removal the revalidated page
 * simply arrives without that person.
 */
export function EventRosterList({
  communityId,
  eventId,
  attendees,
  canRemove,
}: {
  communityId: string;
  eventId: string;
  attendees: EventAttendee[];
  canRemove: boolean;
}) {
  const t = useT();
  const [target, setTarget] = useState<EventAttendee | null>(null);
  const [state, formAction] = useActionState(removeEventAttendeeAction, emptyEventLifecycleFormState);

  // A success closes the dialog and leaves a note under the list; an error
  // stays in the dialog.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "ok") setTarget(null);
  }

  return (
    <>
      <ul className="mt-3 space-y-2">
        {attendees.map((attendee) => (
          <li key={attendee.id} className="flex items-center gap-2.5">
            <Avatar user={{ ...attendee, communityId }} size="xs" />
            <span className={cn("min-w-0 truncate text-[0.9375rem] text-ink", canRemove && "flex-1")}>
              {attendee.name}
            </span>
            {canRemove ? (
              <ActionMenu
                label={t("events.roster.actions", { name: attendee.name })}
                ariaLabel={t("events.roster.actions", { name: attendee.name })}
                align="right"
                trigger={() => <IconMore size={16} />}
                triggerClassName="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
                items={[
                  {
                    key: "remove",
                    label: t("events.roster.remove"),
                    icon: <IconUserMinus size={15} />,
                    danger: true,
                    onSelect: () => setTarget(attendee),
                  },
                ]}
              />
            ) : null}
          </li>
        ))}
      </ul>

      {state.status === "ok" && target === null ? (
        <p role="status" className="mt-3 text-[12px] text-ink-3">
          {state.message}
        </p>
      ) : null}

      {canRemove ? (
        <ConfirmDialog open={target !== null} onClose={() => setTarget(null)} labelledBy="event-remove-attendee-title">
          <h3 id="event-remove-attendee-title" className="font-display text-lg leading-snug text-ink">
            {t("events.roster.removeTitle", { name: target?.name ?? "" })}
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            {t("events.roster.removeBody", { name: target?.name ?? "" })}
          </p>
          {state.status === "error" && target ? (
            <p role="alert" className="mt-3 text-[13px] text-rust">
              {state.error}
            </p>
          ) : null}
          <form action={formAction} className="mt-5 flex flex-wrap justify-end gap-2">
            <input type="hidden" name="communityId" value={communityId} />
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="userId" value={target?.id ?? ""} />
            <button
              type="button"
              onClick={() => setTarget(null)}
              className="h-9 rounded-[5px] px-3 text-sm text-ink-2 hover:bg-paper-2"
            >
              {t("common.cancel")}
            </button>
            <RemoveButton>{t("events.roster.remove")}</RemoveButton>
          </form>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
