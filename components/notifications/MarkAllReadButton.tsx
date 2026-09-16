"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { markAllNotificationsReadAction } from "@/app/actions";
import { emptyNotificationFormState } from "@/lib/notification-form";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      // -my-3/py-3 grows the tap target to a comfortable size on a phone
      // without changing the box it occupies: the padding adds what the
      // negative margin takes back, so the header lays out exactly as before.
      className="-my-3 py-3 text-[13px] text-ink-2 underline-offset-4 transition-colors hover:text-ink hover:underline disabled:opacity-40"
    >
      {pending ? "Merker …" : "Merk alle som lest"}
    </button>
  );
}

/**
 * "Merk alle som lest".
 *
 * A real button in a real form, not a link styled as one: it performs a write
 * and goes nowhere.
 *
 * The page renders this only when something is unread, so there is no disabled
 * button sitting there for a keyboard user to land on and wonder about. What
 * it calls — `mark_notifications_read()` — scopes itself to `auth.uid()` in
 * the database, so it cannot reach anyone else's notifications whatever the
 * page does.
 */
export function MarkAllReadButton() {
  const [state, action] = useActionState(
    markAllNotificationsReadAction,
    emptyNotificationFormState,
  );

  return (
    <form action={action} className="flex items-center gap-3">
      <Submit />
      {state.status === "error" ? (
        <span role="alert" className="text-[13px] text-rust">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
