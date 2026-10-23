"use client";

import { useActionState } from "react";
import { reviewRequestAction, saveRequestNoteAction } from "@/app/platform-admin/actions";
import { Field, FormMessage, textareaClass } from "@/components/platform/ui";
import { Button, ButtonLink } from "@/components/ui/primitives";
import { idleState } from "@/lib/platform/forms";

export function RequestNoteForm({ requestId, note }: { requestId: string; note: string | null }) {
  const [state, action, pending] = useActionState(saveRequestNoteAction, idleState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="requestId" value={requestId} />
      <Field id="request-note" label="Interne notater" hint="Bare for plattformadministratorer. Skriv ikke inn mer personinformasjon enn nødvendig.">
        <textarea id="request-note" name="note" defaultValue={note ?? ""} rows={4} maxLength={3000} className={textareaClass} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? "Lagrer …" : "Lagre notat"}
      </Button>
    </form>
  );
}

export function RequestDecision({ requestId, status, hasCommunity }: { requestId: string; status: "pending" | "approved" | "rejected"; hasCommunity: boolean }) {
  const [state, action, pending] = useActionState(reviewRequestAction, idleState);

  if (status === "rejected") {
    return <p className="text-sm text-ink-2">Forespørselen er avslått.</p>;
  }

  return (
    <div className="space-y-4">
      {!hasCommunity ? (
        <div className="space-y-2">
          <ButtonLink href={`/platform-admin/fellesskap/nytt?foresporsel=${requestId}`}>Godkjenn og opprett fellesskap</ButtonLink>
          <p className="text-xs text-ink-3">
            Åpner opprettelsen med navnet og kontaktadressen fylt ut. Forespørselen godkjennes i det fellesskapet opprettes.
          </p>
        </div>
      ) : null}
      {status === "pending" ? (
        <form action={action} className="space-y-3 border-t border-line pt-4">
          <input type="hidden" name="requestId" value={requestId} />
          <Field id="decision-note" label="Begrunnelse" optional hint="Lagres som internt notat.">
            <textarea id="decision-note" name="note" rows={2} maxLength={3000} className={textareaClass} />
          </Field>
          <FormMessage state={state} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="decision" value="approved" variant="secondary" disabled={pending}>
              Godkjenn uten å opprette nå
            </Button>
            <Button type="submit" name="decision" value="rejected" variant="secondary" className="text-rust" disabled={pending}>
              Avslå
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
