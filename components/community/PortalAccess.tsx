"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { requestAccessAction } from "@/app/actions";
import { DISPLAY_NAME_MAX, emptyAccessFormState } from "@/lib/access-form";
import { Badge, Panel } from "@/components/ui/primitives";
import { IconCheck, IconLock, IconMail } from "@/components/ui/icons";
import type { CommunityPublic } from "@/lib/types";

function SubmitButton({ accent, disabled }: { accent: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="mt-3 h-10 w-full rounded-[5px] text-sm font-medium text-white transition-opacity disabled:opacity-30"
      style={{ backgroundColor: accent }}
    >
      {pending ? "Sender …" : "Be om tilgang"}
    </button>
  );
}

/**
 * The public request form.
 *
 * An address is all it asks for. The person filling this in is usually already
 * a member of the organisation and has never heard of TING, so the copy says
 * plainly that this does not create a membership and that TING is a separate
 * service from the organisation itself.
 *
 * The confirmation is the same sentence for every outcome. Whether the address
 * is new, already a member, already pending or being rate-limited is decided
 * in the database and never reaches this component, so there is nothing here
 * that could tell the two apart even by accident.
 */
export function PortalAccess({
  community,
  signedIn,
  heading = "Er du medlem?",
  intro = `Er du medlem av ${community.name} og ønsker tilgang til det digitale fellesskapet? Be om tilgang, så tar en administrator stilling til forespørselen.`,
  pending = false,
}: {
  community: CommunityPublic;
  signedIn: boolean;
  /**
   * The two lines above the form are the only ones a caller can swap in —
   * everything else (what a request does, whether it needs an account) stays
   * fixed, since it is describing the underlying request-to-join mechanism
   * rather than the community itself.
   */
  heading?: string;
  intro?: string;
  /**
   * The signed-in visitor already has a request waiting, as decided by the
   * database from their own session. Shown instead of the form. Never derived
   * from an address typed into the form.
   */
  pending?: boolean;
}) {
  const [state, formAction] = useActionState(requestAccessAction, emptyAccessFormState);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  if (community.accessPolicy === "invite-only") {
    return (
      <Panel className="p-5">
        <Badge tone="neutral">
          <IconLock size={11} />
          Kun ved invitasjon
        </Badge>
        <h2 className="mt-3 font-display text-lg text-ink">Dette rommet er lukket</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {community.name} tar ikke imot åpne søknader. Nye medlemmer blir invitert av noen som
          allerede er her.
        </p>
      </Panel>
    );
  }

  if (pending && state.status !== "ok") {
    return (
      <Panel className="p-5">
        <p className="label">Forespørsel sendt</p>
        <p className="mt-3 font-display text-lg text-ink">Forespørselen din er til behandling.</p>
      </Panel>
    );
  }

  if (state.status === "ok") {
    return (
      <Panel className="p-5">
        <p className="flex items-start gap-2 text-[0.9375rem] font-medium text-ink">
          <IconCheck size={17} className="mt-0.5 shrink-0" style={{ color: community.branding.accent }} />
          {state.message}
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          Blir den godkjent, får du beskjed. Har du allerede en TING-konto med denne adressen, blir
          tilgangen aktiv med det samme neste gang du logger inn. Har du det ikke, får du en e-post
          med en lenke for å logge inn eller opprette konto. Får du ingen e-post, kan du spørre
          organisasjonen direkte.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="p-5">
      <h2 className="font-display text-lg text-ink">{heading}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{intro}</p>

      <form action={formAction} className="mt-4">
        <input type="hidden" name="slug" value={community.slug} />

        <label htmlFor="email" className="label">
          E-postadresse
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="navn@example.no"
          className="mt-2 w-full rounded-[5px] border border-line-2 bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink-3"
        />

        <label htmlFor="displayName" className="label mt-3 block">
          Navn eller pseudonym
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
          className="mt-2 w-full rounded-[5px] border border-line-2 bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink-3"
        />
        <p id="displayName-hint" className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
          Dette er navnet andre ser når du deltar i samtaler. Du kan bruke ditt eget navn eller et
          pseudonym.
        </p>

        {state.status === "error" ? (
          <p role="alert" className="mt-3 text-[13px] text-rust">
            {state.message}
          </p>
        ) : null}

        <SubmitButton accent={community.branding.accent} disabled={!email.trim() || !name.trim()} />
      </form>

      <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-ink-3">
        <IconMail size={13} className="mt-px shrink-0" />
        Å be om tilgang oppretter ikke medlemskap. En administrator i fellesskapet må godkjenne
        forespørselen. TING er et separat digitalt fellesskap og påvirker ikke det formelle
        medlemskapet ditt i {community.name}.
      </p>

      {signedIn ? null : (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          Du trenger ingen TING-konto for å spørre. Blir forespørselen godkjent, kan du logge inn
          eller opprette kontoen da.
        </p>
      )}
    </Panel>
  );
}
