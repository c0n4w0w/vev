"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { requestAccessAction } from "@/app/actions";
import { DISPLAY_NAME_MAX, emptyAccessFormState } from "@/lib/access-form";
import { IconCheck } from "@/components/ui/icons";
import type { CommunityPublic } from "@/lib/types";

const field =
  "mt-1.5 w-full rounded-[3px] border border-line-2 bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink-3";
const hint = "mt-1.5 text-[11px] leading-relaxed text-ink-3";

function SubmitButton({ accent, disabled }: { accent: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="mt-5 h-11 w-full rounded-[3px] text-sm font-medium text-white transition-opacity disabled:opacity-30"
      style={{ backgroundColor: accent }}
    >
      {pending ? "Sender …" : "Be om tilgang"}
    </button>
  );
}

/**
 * The compact request form on the Tryggere portals.
 *
 * It posts to the same `requestAccessAction` as every other portal's form;
 * only the presentation and the copy differ. The display name is required
 * here and again on the server. The confirmation is one fixed message for
 * every outcome — whether the address is new, already a member, already
 * pending or rate-limited is decided in the database and never reaches this
 * component, so nothing here could reveal it.
 */
export function TryggereAccessForm({ community }: { community: CommunityPublic }) {
  const accent = community.branding.accent;
  const [state, formAction] = useActionState(requestAccessAction, emptyAccessFormState);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  if (community.accessPolicy === "invite-only") {
    return (
      <div className="border border-line bg-surface p-5">
        <p className="text-[0.9375rem] leading-relaxed text-ink-2">
          {community.name} tar ikke imot forespørsler her. Nye får tilgang ved invitasjon.
        </p>
      </div>
    );
  }

  if (state.status === "ok") {
    return (
      <div className="border border-line bg-surface p-5 sm:p-6" role="status">
        <p className="flex items-start gap-2.5 text-[0.9375rem] leading-relaxed text-ink">
          <IconCheck size={17} className="mt-0.5 shrink-0" style={{ color: accent }} />
          Forespørselen din er sendt. Vi sjekker medlemskapet manuelt, og du får vanligvis tilgang
          innen 24 timer.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-line bg-surface p-5 sm:p-6">
      <form action={formAction}>
        <input type="hidden" name="slug" value={community.slug} />

        <label htmlFor="email" className="label">
          E-postadresse
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          aria-describedby="email-hint"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="navn@example.no"
          className={field}
        />
        <p id="email-hint" className={hint}>
          Bruk e-postadressen som er knyttet til medlemskapet ditt.
        </p>

        <label htmlFor="displayName" className="label mt-4 block">
          Visningsnavn
        </label>
        <input
          id="displayName"
          name="displayName"
          autoComplete="nickname"
          aria-describedby="displayName-hint"
          required
          maxLength={DISPLAY_NAME_MAX}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Navn eller pseudonym"
          className={field}
        />
        <p id="displayName-hint" className={hint}>
          Navnet andre ser når du deltar i fellesskapet. Du kan bruke ditt eget navn eller et
          pseudonym.
        </p>

        {state.status === "error" ? (
          <p role="alert" className="mt-3 text-[13px] text-rust">
            {state.message}
          </p>
        ) : null}

        <SubmitButton accent={accent} disabled={!email.trim() || !name.trim()} />
      </form>

      <p className="mt-3 text-center text-[12px] text-ink-3">Vanligvis godkjent innen 24 timer.</p>

      {/* A safeguard, not a second login button: someone who already has access
          should not file another request. The header's "Logg inn" stays the
          normal way back in; this goes to the same place, returning here. */}
      <p className="mt-2 text-center text-[12px] text-ink-3">
        Har du allerede tilgang til fellesskapet?{" "}
        <Link
          href={`/login?neste=/${community.slug}`}
          className="font-medium text-ink-2 underline underline-offset-2 transition-colors hover:text-ink"
        >
          Logg inn
        </Link>
      </p>
    </div>
  );
}
