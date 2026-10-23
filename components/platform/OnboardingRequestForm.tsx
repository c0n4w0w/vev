"use client";

import { useActionState, useState } from "react";
import { submitOnboardingRequestAction } from "@/app/samarbeid/actions";
import { Field, FormMessage, inputClass, textareaClass } from "@/components/platform/ui";
import { Button } from "@/components/ui/primitives";
import { idleState } from "@/lib/platform/forms";

export function OnboardingRequestForm() {
  const [state, action, pending] = useActionState(submitOnboardingRequestAction, idleState);
  const [startedAt] = useState(() => String(Date.now()));
  const errors = state.fields ?? {};

  if (state.status === "ok") {
    return (
      <div role="status" className="rounded-[6px] border border-[#cfdfd5] bg-skog-soft px-5 py-6">
        <p className="font-display text-xl text-skog">Takk!</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="startedAt" value={startedAt} />
      {/* For bots only: hidden from people and from assistive technology. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="company_url">Ikke fyll ut dette feltet</label>
        <input id="company_url" name="company_url" tabIndex={-1} autoComplete="off" />
      </div>

      <Field id="organizationName" label="Organisasjonens navn" error={errors.organizationName}>
        <input id="organizationName" name="organizationName" required maxLength={120} autoComplete="organization" className={inputClass} aria-invalid={Boolean(errors.organizationName)} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="contactName" label="Navnet ditt" error={errors.contactName}>
          <input id="contactName" name="contactName" required maxLength={120} autoComplete="name" className={inputClass} aria-invalid={Boolean(errors.contactName)} />
        </Field>
        <Field id="contactEmail" label="E-post" error={errors.contactEmail}>
          <input id="contactEmail" name="contactEmail" type="email" required maxLength={254} autoComplete="email" className={inputClass} aria-invalid={Boolean(errors.contactEmail)} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="website" label="Nettsted" optional error={errors.website}>
          <input id="website" name="website" type="url" maxLength={300} placeholder="https://" className={inputClass} aria-invalid={Boolean(errors.website)} />
        </Field>
        <Field id="memberEstimate" label="Omtrent hvor mange medlemmer" optional error={errors.memberEstimate}>
          <input id="memberEstimate" name="memberEstimate" inputMode="numeric" maxLength={8} className={inputClass} aria-invalid={Boolean(errors.memberEstimate)} />
        </Field>
      </div>
      <Field id="message" label="Fortell kort om organisasjonen og hva dere ønsker" error={errors.message}>
        <textarea id="message" name="message" required minLength={10} maxLength={3000} rows={6} className={textareaClass} aria-invalid={Boolean(errors.message)} />
      </Field>
      <div>
        <label className="flex items-start gap-2 text-sm text-ink-2">
          <input type="checkbox" name="consent" className="mt-1" aria-invalid={Boolean(errors.consent)} />
          <span>
            TING kan lagre opplysningene i skjemaet for å behandle forespørselen og kontakte meg. De brukes ikke til noe annet.
          </span>
        </label>
        {errors.consent ? <p className="mt-1 text-xs text-rust">{errors.consent}</p> : null}
      </div>
      <FormMessage state={state} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Sender …" : "Send forespørsel"}
      </Button>
    </form>
  );
}
