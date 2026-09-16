"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Badge, cn } from "@/components/ui/primitives";
import { IconCheck } from "@/components/ui/icons";
import { rsvpEventAction } from "@/app/actions";
import { emptyRsvpFormState } from "@/lib/event-form";

function Submit({
  attending,
  accent,
  full,
}: {
  attending: boolean;
  accent: string;
  full: boolean;
}) {
  const { pending } = useFormStatus();

  if (!attending && full) {
    return (
      <button
        type="button"
        disabled
        className="h-10 rounded-[5px] border border-line-2 px-4 text-sm text-ink-3"
      >
        Fullt
      </button>
    );
  }

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "h-10 rounded-[5px] px-4 text-sm font-medium transition-opacity disabled:opacity-40",
        attending ? "border border-line-2 text-ink-2 hover:border-ink-3" : "text-white",
      )}
      style={attending ? undefined : { backgroundColor: accent }}
    >
      {pending ? "Lagrer …" : attending ? "Meld deg av" : "Meld deg på"}
    </button>
  );
}

/**
 * Signing up for an event, and changing your mind.
 *
 * The button shows the action, not the state — "Meld deg på" when you are not
 * going, "Meld deg av" when you are — with the state itself carried by the
 * badge beside it. A full event that you are not attending offers nothing to
 * press, which is honest: the database refuses that write, so a live button
 * would only produce an error.
 */
export function EventRsvp({
  eventId,
  communityId,
  accent,
  initialAttending,
  attendeeCount,
  capacity,
}: {
  eventId: string;
  communityId: string;
  accent: string;
  initialAttending: boolean;
  attendeeCount: number;
  capacity?: number;
}) {
  const [state, formAction] = useActionState(rsvpEventAction, emptyRsvpFormState);

  // The server's answer wins as soon as there is one. Tracking the handled
  // state lets that happen during render rather than in an effect.
  const [attending, setAttending] = useState(initialAttending);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "ok") setAttending(state.attending);
  }

  const count = attendeeCount + (attending === initialAttending ? 0 : attending ? 1 : -1);
  const full = capacity !== undefined && count >= capacity;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="communityId" value={communityId} />
      {attending ? <input type="hidden" name="leaving" value="1" /> : null}

      <Submit attending={attending} accent={accent} full={full} />

      {attending ? (
        <Badge tone="skog">
          <IconCheck size={11} />
          Påmeldt
        </Badge>
      ) : null}

      <span className="text-[13px] text-ink-3">
        {count} {count === 1 ? "påmeldt" : "påmeldte"}
        {capacity !== undefined ? ` av ${capacity}` : ""}
      </span>

      {state.status === "error" ? (
        <p role="alert" className="w-full text-[13px] text-rust">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
