"use client";

import { startTransition, useActionState, useState } from "react";
import { setReactionVisibilityAction, type ReactionVisibilityFormState } from "@/app/reaction-actions";
import { cn } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/react";
import type { ReactionAuthorVisibility } from "@/lib/types";

const OPTIONS = [
  { value: "moderators", label: "settings.reactions.moderators", help: "settings.reactions.moderatorsHelp" },
  { value: "channel", label: "settings.reactions.channel", help: "settings.reactions.channelHelp" },
] as const;

/**
 * Who may see who reacted in the community's own channels — for its
 * administrators, under Innstillinger.
 *
 * Choosing an option saves it at once. What stays selected is what the database
 * reported back, so a refusal shows as the choice moving back rather than as
 * a setting that silently means nothing. set_community_reaction_visibility()
 * refuses everyone but an active admin, whatever this page draws.
 */
export function ReactionVisibilitySetting({
  communityId,
  communityName,
  accent,
  initial,
}: {
  communityId: string;
  communityName: string;
  accent: string;
  initial: ReactionAuthorVisibility;
}) {
  const t = useT();
  const [state, formAction, pending] = useActionState<ReactionVisibilityFormState, FormData>(
    setReactionVisibilityAction,
    { status: "idle" },
  );
  // The stored value wins as soon as the server reports one; a refusal puts
  // the last stored value back. Tracking the handled state lets that happen
  // during render, without an effect.
  const [stored, setStored] = useState(initial);
  const [choice, setChoice] = useState(initial);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "ok") {
      setStored(state.value);
      setChoice(state.value);
    } else if (state.status === "error") {
      setChoice(stored);
    }
  }

  return (
    // Not a form action: React resets a form after its action runs, which
    // would put these controlled options back to their first value.
    <form onSubmit={(event) => event.preventDefault()} className="p-5">
      <fieldset disabled={pending}>
        <legend className="text-[0.9375rem] font-medium text-ink">{t("settings.reactions.question")}</legend>
        <div className="mt-3 space-y-2">
          {OPTIONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-[6px] border px-3.5 py-3 transition-colors",
                choice === option.value ? "border-ink-3 bg-paper" : "border-line hover:border-line-2",
              )}
            >
              <input
                type="radio"
                name="value"
                value={option.value}
                checked={choice === option.value}
                onChange={() => {
                  setChoice(option.value);
                  const form = new FormData();
                  form.set("communityId", communityId);
                  form.set("value", option.value);
                  startTransition(() => formAction(form));
                }}
                className="mt-1 shrink-0"
                style={{ accentColor: accent }}
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{t(option.label)}</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-2">{t(option.help)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-ink-3">
        {t("settings.reactions.scope", { name: communityName })}
      </p>
      <p role="status" className="mt-2 min-h-[1rem] text-[12px]">
        {state.status === "error" ? (
          <span className="text-rust">{state.error}</span>
        ) : state.status === "ok" && !pending ? (
          <span className="text-skog">{t("settings.reactions.saved")}</span>
        ) : null}
      </p>
    </form>
  );
}
