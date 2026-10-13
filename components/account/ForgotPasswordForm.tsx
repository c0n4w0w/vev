"use client";

import { useActionState } from "react";
import { requestPasswordResetAction } from "@/app/account-actions";
import { emptyForgotPasswordFormState } from "@/lib/account-form";
import { useLocale, useT } from "@/lib/i18n/react";
import { Field, FormError, SubmitButton } from "./fields";

/**
 * Asks for a reset link. The answer is the same for every well-formed
 * address, and it stays on the page rather than going into the address bar.
 */
export function ForgotPasswordForm({ email }: { email?: string }) {
  const locale = useLocale();
  const t = useT();
  const [state, formAction] = useActionState(requestPasswordResetAction, emptyForgotPasswordFormState);

  if (state.status === "sent") {
    return (
      <div role="status">
        <h2 className="text-[0.9375rem] font-medium text-ink">{t("forgot.sent.title")}</h2>
        <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-2">
          {t("forgot.sent.pre")}
          <span className="text-ink [overflow-wrap:anywhere]">{state.email}</span>
          {t("forgot.sent.post")}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {/* Presentation only: the language of a refusal. It grants nothing. */}
      <input type="hidden" name="locale" value={locale} />
      <Field
        id="email"
        name="email"
        type="email"
        required
        autoComplete="username"
        defaultValue={state.status === "error" ? (state.email ?? email) : email}
        label={t("login.emailLabel")}
        placeholder={t("login.emailPlaceholder")}
      />
      {state.status === "error" ? <FormError>{state.message}</FormError> : null}
      <SubmitButton label={t("forgot.submit")} working={t("forgot.working")} />
    </form>
  );
}
