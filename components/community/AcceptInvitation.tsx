"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { acceptInvitationAction } from "@/app/actions";
import { emptyAccessFormState } from "@/lib/access-form";

function Submit({ accent }: { accent: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 w-full rounded-[5px] text-sm font-medium text-white transition-opacity disabled:opacity-40"
      style={{ backgroundColor: accent }}
    >
      {pending ? "Blir med …" : "Fortsett"}
    </button>
  );
}

/**
 * The accept button.
 *
 * Carries only the token. Which community and which address the invitation is
 * for is decided in the database from that token, so nothing in this form can
 * be edited to join somewhere else or as somebody else.
 */
export function AcceptInvitation({ token, accent }: { token: string; accent: string }) {
  const [state, formAction] = useActionState(acceptInvitationAction, emptyAccessFormState);

  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <Submit accent={accent} />
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
