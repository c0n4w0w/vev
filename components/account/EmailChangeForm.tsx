"use client";

import { useActionState } from "react";
import { requestEmailChangeAction } from "@/app/account-actions";
import { emptyEmailChangeFormState } from "@/lib/account-form";
import { useLocale, useT } from "@/lib/i18n/react";
import { Field, FormError, SubmitButton } from "./fields";

/**
 * New address and current password.
 *
 * The password is asked for every time: being signed in is not the proof.
 * The form names no account — the server takes that from the session — and
 * the reply does not say whether the new address was free.
 */
export function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  const locale = useLocale();
  const t = useT();
  const [state, formAction] = useActionState(requestEmailChangeAction, emptyEmailChangeFormState);

  if (state.status === "sent") {
    return (
      <div role="status">
        <h2 className="text-[0.9375rem] font-medium text-ink">{t("security.changeEmail.sent.title")}</h2>
        <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-2">
          {t("security.changeEmail.sent.pre")}
          <span className="text-ink [overflow-wrap:anywhere]">{state.email}</span>
          {t("security.changeEmail.sent.post")}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {/* Presentation only: the language of a refusal. It grants nothing. */}
      <input type="hidden" name="locale" value={locale} />
      {/* For password managers: which login the password below belongs to. */}
      <input type="email" name="username" autoComplete="username" value={currentEmail} readOnly hidden />
      <Field
        id="email"
        name="email"
        type="email"
        required
        autoComplete="off"
        defaultValue={state.status === "error" ? state.email : undefined}
        label={t("security.changeEmail.new")}
        placeholder={t("login.emailPlaceholder")}
      />
      <Field
        id="email-current"
        name="current"
        type="password"
        required
        autoComplete="current-password"
        label={t("security.changeEmail.password")}
        hint={t("security.changeEmail.passwordHint")}
      />
      {state.status === "error" ? <FormError>{state.message}</FormError> : null}
      <div className="pt-1">
        <SubmitButton
          label={t("security.changeEmail.submit")}
          working={t("security.changeEmail.working")}
        />
      </div>
    </form>
  );
}
