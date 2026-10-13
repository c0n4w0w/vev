"use client";

import Link from "next/link";
import { useActionState } from "react";
import { sendMagicLink } from "@/app/actions";
import { buttonClass } from "@/components/ui/primitives";
import { emptyPasswordFormState, type PasswordFormState } from "@/lib/account-form";
import { useLocale, useT } from "@/lib/i18n/react";
import { PASSWORD_MIN_LENGTH } from "@/lib/password";
import { Field, FormError, SubmitButton } from "./fields";

type PasswordAction = (state: PasswordFormState, formData: FormData) => Promise<PasswordFormState>;

/**
 * The one form every password is chosen in: the step after an approval, a
 * reset link, and creating or changing one under Sikkerhet.
 *
 * It only collects. Which account, and whether the person may set a password
 * at all, is decided on the server from the session or the emailed link —
 * nothing here names an account.
 */
export function PasswordForm({
  action,
  fields = {},
  email,
  withCurrent = false,
  submitLabel,
  expired,
  retry,
  reauthNext,
  notice,
}: {
  action: PasswordAction;
  fields?: Record<string, string>;
  /** The account's address, so a password manager files the password under it. */
  email?: string;
  /** Ask for the current password as well (changing one). */
  withCurrent?: boolean;
  submitLabel: string;
  /** What to offer when an emailed link turns out to be spent or expired. */
  expired?: { title: string; body: string; href: string; action: string };
  /** How to carry on once a link has signed the person in but the password was refused. */
  retry?: { action: PasswordAction; fields: Record<string, string> };
  /** Where a fresh sign-in link should return to, if the session is too old to set a password. */
  reauthNext?: string;
  /** A message carried over from the step before. */
  notice?: string;
}) {
  const locale = useLocale();
  const t = useT();
  const [state, formAction] = useActionState(action, emptyPasswordFormState);

  if (state.status === "retry" && retry) {
    return (
      <PasswordForm
        action={retry.action}
        fields={retry.fields}
        email={email}
        submitLabel={submitLabel}
        reauthNext={reauthNext}
        notice={`${state.message} ${t("reset.retry")}`}
      />
    );
  }

  if (state.status === "link-expired" && expired) {
    return (
      <div role="alert" className="rounded-[6px] border border-line bg-surface p-5">
        <h2 className="text-[0.9375rem] font-medium text-ink">{expired.title}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{expired.body}</p>
        <Link href={expired.href} className={`${buttonClass()} mt-4`}>
          {expired.action}
        </Link>
      </div>
    );
  }

  if (state.status === "reauth" && email && reauthNext) {
    return (
      <div role="alert" className="rounded-[6px] border border-line bg-surface p-5">
        <h2 className="text-[0.9375rem] font-medium text-ink">{t("password.reauth.title")}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{t("password.reauth.body")}</p>
        <form action={sendMagicLink} className="mt-4">
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="next" value={reauthNext} />
          <button type="submit" className={buttonClass()}>
            {t("password.reauth.action")}
          </button>
        </form>
      </div>
    );
  }

  const message = state.status === "error" || state.status === "retry" ? state.message : notice;

  return (
    <form action={formAction} className="space-y-4">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {/* Presentation only: the language of a refusal. It grants nothing. */}
      <input type="hidden" name="locale" value={locale} />
      {email ? (
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      ) : null}
      {withCurrent ? (
        <Field
          id="current"
          name="current"
          type="password"
          required
          autoComplete="current-password"
          label={t("password.current")}
        />
      ) : null}
      <Field
        id="password"
        name="password"
        type="password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        autoComplete="new-password"
        label={t(withCurrent ? "password.newChange" : "password.new")}
        hint={t("password.hint", { min: PASSWORD_MIN_LENGTH })}
      />
      <Field
        id="confirmation"
        name="confirmation"
        type="password"
        required
        autoComplete="new-password"
        label={t("password.confirm")}
      />
      {message ? <FormError>{message}</FormError> : null}
      <div className="pt-1">
        <SubmitButton label={submitLabel} working={t("password.working")} />
      </div>
    </form>
  );
}
