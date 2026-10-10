"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui/primitives";
import { emptyInvitationLinkState, type InvitationLinkState } from "@/lib/invitation-link-form";
import { useLocale, useT } from "@/lib/i18n/react";

function Submit({ label, accent, quiet }: { label: string; accent: string; quiet?: boolean }) {
  const { pending } = useFormStatus();
  const t = useT();
  if (quiet) {
    return (
      <button
        type="submit"
        disabled={pending}
        className="text-[13px] text-ink-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink disabled:opacity-40"
      >
        {pending ? t("inv.link.working") : label}
      </button>
    );
  }
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 w-full rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
      style={{ backgroundColor: accent }}
    >
      {pending ? t("inv.link.working") : label}
    </button>
  );
}

/**
 * The one button an approval email leads to.
 *
 * Opening the link only renders this; pressing it is what spends the sign-in
 * token. That split is the defence against mail scanners and link previews,
 * which fetch URLs but do not submit forms — so a preview can never use up
 * the link, sign anyone in or activate a membership.
 *
 * The form carries only what the URL already did. Which account may be signed
 * in and which community is joined are decided on the server from the tokens.
 */
export function EmailLinkSignIn({
  action,
  fields,
  label,
  accent,
  quiet = false,
  recovery,
}: {
  action: (state: InvitationLinkState, formData: FormData) => Promise<InvitationLinkState>;
  fields: Record<string, string>;
  label: string;
  accent: string;
  /** Render as a text link instead of the full-width button. */
  quiet?: boolean;
  /** What to offer once the sign-in part of the link is spent or expired. */
  recovery: { title: string; body: string; href: string; action: string };
}) {
  const locale = useLocale();
  const t = useT();
  const [state, formAction] = useActionState(action, emptyInvitationLinkState);

  if (state.status === "link-expired") {
    return (
      <div role="alert" className="rounded-[6px] border border-line bg-surface p-5">
        <h2 className="text-[0.9375rem] font-medium text-ink">{recovery.title}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{recovery.body}</p>
        <Link href={recovery.href} className={`${buttonClass()} mt-4`}>
          {recovery.action}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {/* Presentation only: the language of a refusal. It grants nothing. */}
      <input type="hidden" name="locale" value={locale} />
      <Submit label={label} accent={accent} quiet={quiet} />
      {state.status === "error" ? (
        <p
          role="alert"
          className="mt-3 rounded-[5px] border border-rust/25 bg-rust-soft px-3 py-2 text-[13px] leading-relaxed text-rust"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === "mismatch" ? (
        <p role="alert" className="mt-3 text-[13px] leading-relaxed text-rust">
          {t("err.invitation.mismatch")}
        </p>
      ) : null}
    </form>
  );
}
