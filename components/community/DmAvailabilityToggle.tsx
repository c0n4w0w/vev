"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/components/ui/primitives";
import { setAcceptsMemberDmsAction } from "@/app/actions";
import { emptyDmSettingFormState } from "@/lib/dm-settings-form";

function SubmitSwitch({ on, accent }: { on: boolean; accent: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      role="switch"
      aria-checked={on}
      aria-label="Tillat meldinger fra medlemmer"
      disabled={pending}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40",
        on ? "border-transparent" : "border-line-2 bg-paper",
      )}
      style={on ? { backgroundColor: accent } : undefined}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4.5 w-4.5 rounded-full bg-surface shadow-sm transition-all",
          on ? "left-[1.375rem]" : "left-0.5",
        )}
      />
    </button>
  );
}

/**
 * One staff member's "members may message me" setting, in one community.
 *
 * The switch is a form submission rather than a checkbox that saves itself:
 * the value shown is the value the database reported back, so a refusal shows
 * as the switch staying where it was instead of flipping and silently not
 * meaning anything.
 */
export function DmAvailabilityToggle({
  communityId,
  communityName,
  accent,
  initial,
}: {
  communityId: string;
  communityName: string;
  accent: string;
  initial: boolean;
}) {
  const [state, formAction] = useActionState(setAcceptsMemberDmsAction, emptyDmSettingFormState);

  // The stored value wins as soon as the server reports one. Tracking the
  // handled state lets that happen during render, without an effect.
  const [on, setOn] = useState(initial);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "ok") setOn(state.acceptsMemberDms);
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="communityId" value={communityId} />
      {/* Submitting the opposite of what is stored: the switch is the verb. */}
      {on ? null : <input type="hidden" name="value" value="on" />}

      <div className="flex items-start justify-between gap-5 p-5">
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-medium text-ink">Tillat meldinger fra medlemmer</p>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-ink-2">
            Når dette er aktivert, kan medlemmer av dette fellesskapet starte en direkte melding
            med deg.
          </p>
          <p className="mt-2 text-[11px] text-ink-3">
            Innstillingen gjelder kun {communityName}. Er du med i flere fellesskap, styrer du
            hvert av dem for seg.
          </p>
        </div>
        <SubmitSwitch on={on} accent={accent} />
      </div>

      {state.status === "error" ? (
        <p role="alert" className="border-t border-line px-5 py-3 text-[12px] text-rust">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
