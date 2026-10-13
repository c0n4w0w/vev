"use client";

import Link from "next/link";
import { useActionState } from "react";
import { confirmEmailChangeAction } from "@/app/account-actions";
import { buttonClass } from "@/components/ui/primitives";
import { emptyEmailConfirmFormState } from "@/lib/account-form";
import { useLocale, useT } from "@/lib/i18n/react";
import { FormError, SubmitButton } from "./fields";

/**
 * The button a new address's confirmation email leads to.
 *
 * Opening the link only renders this; pressing it, signed in as the account,
 * is what changes the address. That split keeps mail scanners and link
 * previews from using the link up, and keeps the link from being enough for
 * anyone who is not the account's owner.
 */
export function ConfirmEmailChange({
  tokenHash,
  signedInEmail,
}: {
  tokenHash: string;
  signedInEmail: string;
}) {
  const locale = useLocale();
  const t = useT();
  const [state, formAction] = useActionState(confirmEmailChangeAction, emptyEmailConfirmFormState);

  if (state.status === "half" || state.status === "none") {
    const [title, body] =
      state.status === "half"
        ? [t("confirmEmail.half.title"), t("confirmEmail.half.body")]
        : [t("confirmEmail.none.title"), t("confirmEmail.none.body", { email: signedInEmail })];
    return (
      <div role="status" className="rounded-[6px] border border-line bg-surface p-5">
        <h2 className="text-[0.9375rem] font-medium text-ink">{title}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{body}</p>
        <Link href="/profile" className={`${buttonClass({ variant: "secondary" })} mt-4`}>
          {t("confirmEmail.toAccount")}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token_hash" value={tokenHash} />
      {/* Presentation only: the language of a refusal. It grants nothing. */}
      <input type="hidden" name="locale" value={locale} />
      {state.status === "error" ? <FormError>{state.message}</FormError> : null}
      <SubmitButton label={t("confirmEmail.submit")} working={t("confirmEmail.working")} />
    </form>
  );
}
