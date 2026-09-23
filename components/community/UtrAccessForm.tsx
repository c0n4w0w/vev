"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { requestAccessAction } from "@/app/actions";
import { DISPLAY_NAME_MAX, emptyAccessFormState } from "@/lib/access-form";
import type { CommunityPublic } from "@/lib/types";
import styles from "./UtrPortal.module.css";

const field =
  "mt-3 block w-full rounded-none border-0 border-b border-(--utr-ink)/30 bg-transparent px-0 pb-2.5 pt-1 text-[1.125rem] text-(--utr-ink) outline-none transition-[border-color,box-shadow] hover:border-(--utr-ink)/60 focus:border-(--utr-ink) focus:shadow-[inset_0_-1px_0_var(--utr-ink)]";
const label = `${styles.tracked} block text-(--utr-muted)`;

/**
 * Set in the same link language as the hero ("BE OM TILGANG →"), but still a
 * real submit button with a 44px target. Never greyed out before the fields
 * are filled — the browser's `required` check and the server action catch
 * anything missing; it only locks while in flight.
 */
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={styles.textLink}>
      <span className={styles.label}>
        {pending ? "Sender …" : "Be om tilgang"}{" "}
        <span aria-hidden="true" className={styles.arrow}>
          →
        </span>
      </span>
    </button>
  );
}

/**
 * The Under The Rug request form — an invitation rather than an application.
 *
 * Posts to the same `requestAccessAction` as every other portal, with the same
 * two fields; only the voice and the presentation are UTR's own. What a
 * request does and does not do (no membership, no account needed, TING is a
 * separate service) is still said, just quietly and last. The confirmation is
 * one fixed message for every outcome, so nothing here could reveal whether an
 * address is new, pending or already a member.
 */
export function UtrAccessForm({
  community,
  signedIn,
  pending = false,
}: {
  community: CommunityPublic;
  signedIn: boolean;
  /** The signed-in visitor already has a request waiting (decided server-side). */
  pending?: boolean;
}) {
  const [state, formAction] = useActionState(requestAccessAction, emptyAccessFormState);
  // Controlled so the values survive an error response.
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  if (community.accessPolicy === "invite-only") {
    return (
      <p className="max-w-md text-[1.0625rem] leading-relaxed text-(--utr-ink-2)">
        Akkurat nå kommer man inn ved invitasjon fra noen som allerede er der. Kjenner du noen, spør
        dem.
      </p>
    );
  }

  if (state.status === "ok" || pending) {
    return (
      <div role="status" className="max-w-md border-t border-(--utr-rule) pt-6">
        <p className={`${styles.serif} text-[1.75rem] leading-tight italic`}>
          {state.status === "ok" ? "Takk. Vi har fått den." : "Vi har forespørselen din."}
        </p>
        <p className="mt-3 text-[1rem] leading-relaxed text-(--utr-ink-2)">
          Noen fra Under The Rug ser på den, og du får beskjed når du er inne.
        </p>
        <p className="mt-5 text-[0.8125rem] leading-relaxed text-(--utr-muted)">
          Har du allerede en TING-konto med denne adressen, blir tilgangen aktiv neste gang du
          logger inn. Har du ikke det, får du en e-post med en lenke for å logge inn eller opprette
          konto. Hører du ingenting, kan du spørre oss direkte.
        </p>
      </div>
    );
  }

  return (
    <div>
      <form action={formAction} className="grid gap-9">
        <input type="hidden" name="slug" value={community.slug} />

        <div>
          <label htmlFor="displayName" className={label}>
            Navn / pseudonym
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
            className={field}
          />
          <p id="displayName-hint" className="mt-2 text-[0.8125rem] text-(--utr-muted)">
            Det andre ser deg som der inne.
          </p>
        </div>

        <div>
          <label htmlFor="email" className={label}>
            E-post
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={field}
          />
        </div>

        {state.status === "error" ? (
          <p role="alert" className="text-[0.9375rem] text-(--utr-rust)">
            {state.message}
          </p>
        ) : null}

        <div>
          <SubmitButton />
          <p className={`${styles.serif} mt-6 max-w-sm text-[1.125rem] leading-snug italic text-(--utr-ink-2)`}>
            Ingen medlemsavgift. Ingen feed å holde tritt med. Bare et sted for folk, idéer og ting
            som skjer.
          </p>
        </div>
      </form>

      {signedIn ? null : (
        <p className="mt-10 text-[0.9375rem] text-(--utr-ink-2)">
          Har du allerede konto?{" "}
          <Link
            href={`/login?neste=/${community.slug}`}
            className="text-(--utr-ink) underline decoration-(--utr-rule) underline-offset-4 transition-colors hover:decoration-(--utr-ink)"
          >
            Logg inn <span aria-hidden="true">→</span>
          </Link>
        </p>
      )}

      {/* The account and membership small print — present, but last. */}
      <p className="mt-10 max-w-md text-[0.75rem] leading-relaxed text-(--utr-muted)">
        Å be om tilgang oppretter ikke medlemskap, og noen fra {community.name} godkjenner hver
        forespørsel. Fellesskapet ligger på TING, en separat tjeneste som ikke påvirker et formelt
        medlemskap i {community.name}.
        {signedIn
          ? null
          : " Du trenger ingen konto for å spørre — blir du godkjent, logger du inn eller oppretter konto da."}
      </p>
    </div>
  );
}
