"use client";

import { useActionState, useState } from "react";
import { Button, cn } from "@/components/ui/primitives";
import {
  emptyCollaborationFormState,
  type CollaborationFormState,
} from "@/lib/collaboration-form";
import { useLocale, useT } from "@/lib/i18n/react";

type Action = (prev: CollaborationFormState, formData: FormData) => Promise<CollaborationFormState>;

/**
 * One button that posts one collaboration action.
 *
 * With `confirm`, the first press only reveals what will happen and a second,
 * explicit button — the same two-step the request queue uses for rejecting.
 * Nothing here decides whether the action is allowed; the reply from the
 * server (and the database behind it) does.
 */
export function ActionButton({
  action,
  fields,
  label,
  variant = "secondary",
  size = "sm",
  confirm,
  className,
  ariaLabel,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  variant?: "primary" | "secondary" | "ghost" | "quiet";
  size?: "sm" | "md";
  confirm?: { note: string; yes: string };
  className?: string;
  /** When several identical buttons share a list, says which row this one acts on. */
  ariaLabel?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(action, emptyCollaborationFormState);
  const [confirming, setConfirming] = useState(false);

  const hidden = (
    <>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="locale" value={locale} />
    </>
  );

  return (
    <div className={cn("min-w-0", className)}>
      {confirm && confirming ? (
        <form action={formAction} className="space-y-2">
          {hidden}
          <p className="max-w-sm text-[13px] leading-relaxed text-ink-2">{confirm.note}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="h-8 rounded-[5px] border border-rust/30 bg-rust-soft px-3 text-sm font-medium text-rust transition-colors hover:bg-rust/10 disabled:opacity-50"
            >
              {pending ? "…" : confirm.yes}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-8 px-2 text-sm text-ink-3 transition-colors hover:text-ink"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : confirm ? (
        <Button
          type="button"
          variant={variant}
          size={size}
          aria-label={ariaLabel}
          onClick={() => setConfirming(true)}
        >
          {label}
        </Button>
      ) : (
        <form action={formAction}>
          {hidden}
          <Button type="submit" variant={variant} size={size} disabled={pending} aria-label={ariaLabel}>
            {pending ? "…" : label}
          </Button>
        </form>
      )}
      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={cn(
            "mt-2 max-w-sm text-[12.5px] leading-relaxed",
            state.status === "error" ? "text-rust" : "text-skog",
          )}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
