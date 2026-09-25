"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { requestAccessAction } from "@/app/actions";
import { DISPLAY_NAME_MAX, emptyAccessFormState } from "@/lib/access-form";
import { translator, type Locale, type Translator } from "@/lib/i18n";
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
function SubmitButton({ t }: { t: Translator }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={styles.textLink}>
      <span className={styles.label}>
        {pending ? t("utr.form.sending") : t("utr.form.submit")}{" "}
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
  locale,
}: {
  community: CommunityPublic;
  signedIn: boolean;
  /** The portal's language. The form is rendered on the server for it. */
  locale: Locale;
  /** The signed-in visitor already has a request waiting (decided server-side). */
  pending?: boolean;
}) {
  const t = translator(locale);
  const [state, formAction] = useActionState(requestAccessAction, emptyAccessFormState);
  // Controlled so the values survive an error response.
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  if (community.accessPolicy === "invite-only") {
    return (
      <p className="max-w-md text-[1.0625rem] leading-relaxed text-(--utr-ink-2)">
        {t("utr.form.inviteOnly")}
      </p>
    );
  }

  if (state.status === "ok" || pending) {
    return (
      <div role="status" className="max-w-md border-t border-(--utr-rule) pt-6">
        <p className={`${styles.serif} text-[1.75rem] leading-tight italic`}>
          {state.status === "ok" ? t("utr.form.thanks") : t("utr.form.haveRequest")}
        </p>
        <p className="mt-3 text-[1rem] leading-relaxed text-(--utr-ink-2)">
          {t("utr.form.lookAt")}
        </p>
        <p className="mt-5 text-[0.8125rem] leading-relaxed text-(--utr-muted)">
          {t("utr.form.accountNote")}
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
            {t("utr.form.displayName")}
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
            {t("utr.form.displayNameHint")}
          </p>
        </div>

        <div>
          <label htmlFor="email" className={label}>
            {t("utr.form.email")}
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
          <SubmitButton t={t} />
          <p className={`${styles.serif} mt-6 max-w-sm text-[1.125rem] leading-snug italic text-(--utr-ink-2)`}>
            {t("utr.form.tagline")}
          </p>
        </div>
      </form>

      {signedIn ? null : (
        <p className="mt-10 text-[0.9375rem] text-(--utr-ink-2)">
          {t("utr.form.haveAccount")}{" "}
          <Link
            href={`/login?neste=/${community.slug}`}
            className="text-(--utr-ink) underline decoration-(--utr-rule) underline-offset-4 transition-colors hover:decoration-(--utr-ink)"
          >
            {t("utr.form.login")} <span aria-hidden="true">→</span>
          </Link>
        </p>
      )}

      {/* The account and membership small print — present, but last. */}
      <p className="mt-10 max-w-md text-[0.75rem] leading-relaxed text-(--utr-muted)">
        {t("utr.form.smallPrint", { name: community.name })}
        {signedIn ? null : t("utr.form.smallPrintNoAccount")}
      </p>
    </div>
  );
}
