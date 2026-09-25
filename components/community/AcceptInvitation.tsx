"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { acceptInvitationAction } from "@/app/actions";
import { emptyAccessFormState } from "@/lib/access-form";
import { useLocale, useT } from "@/lib/i18n/react";

function Submit({ accent, auto }: { accent: string; auto: boolean }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 w-full rounded-[5px] text-sm font-medium text-white transition-opacity disabled:opacity-40"
      style={{ backgroundColor: accent }}
    >
      {pending || auto ? t("inv.activating") : t("inv.continue")}
    </button>
  );
}

/**
 * The accept step.
 *
 * Carries only the token. Which community and which address the invitation is
 * for is decided in the database from that token, so nothing in this form can
 * be edited to join somewhere else or as somebody else.
 *
 * `auto` is true for an invitation that traces back to a request the person
 * already made (see `invitation_preview.auto_activate`). Access was already
 * approved; landing here with a matching signed-in session is the proof of
 * identity the database still requires, not a second decision, so the form
 * submits itself instead of waiting for a click. It stays a real form —
 * without JavaScript, the button is still there and still works, just not
 * pressed automatically.
 */
export function AcceptInvitation({
  token,
  accent,
  auto = false,
}: {
  token: string;
  accent: string;
  auto?: boolean;
}) {
  const locale = useLocale();
  const [state, formAction] = useActionState(acceptInvitationAction, emptyAccessFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (!auto || submittedRef.current) return;
    submittedRef.current = true;
    formRef.current?.requestSubmit();
  }, [auto]);

  return (
    <form ref={formRef} action={formAction}>
      <input type="hidden" name="token" value={token} />
      {/* Presentation only: the language of a refusal. It grants nothing. */}
      <input type="hidden" name="locale" value={locale} />
      <Submit accent={accent} auto={auto} />
      {state.status === "error" ? (
        <p
          role="alert"
          className="mt-3 rounded-[5px] border border-rust/25 bg-rust-soft px-3 py-2 text-[13px] leading-relaxed text-rust"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
