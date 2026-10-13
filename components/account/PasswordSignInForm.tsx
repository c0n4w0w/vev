"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInWithPasswordAction } from "@/app/account-actions";
import { IconArrowRight } from "@/components/ui/icons";
import { emptySignInFormState } from "@/lib/account-form";
import { useLocale, useT } from "@/lib/i18n/react";
import { Field, FormError, SubmitButton } from "./fields";

/**
 * Email and password — the main way in.
 *
 * `next` is where to go afterwards; the server accepts only a path on this
 * site. A refusal comes back as words under the form and never in the address
 * bar, and the password field is empty again when it does.
 */
export function PasswordSignInForm({
  next,
  email,
  forgotHref,
  linkHref,
}: {
  next: string;
  /** Prefilled, for someone arriving from a place that already knows the address. */
  email?: string;
  forgotHref: string;
  linkHref: string;
}) {
  const locale = useLocale();
  const t = useT();
  const [state, formAction] = useActionState(signInWithPasswordAction, emptySignInFormState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
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
      <Field
        id="password"
        name="password"
        type="password"
        required
        autoComplete="current-password"
        label={t("login.passwordLabel")}
      />
      {state.status === "error" ? <FormError>{state.message}</FormError> : null}
      <div className="flex flex-col gap-4 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <SubmitButton
          label={
            <>
              {t("login.submit")}
              <IconArrowRight size={16} />
            </>
          }
          working={t("login.working")}
        />
        <Link
          href={forgotHref}
          className="text-[13px] text-ink-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink"
        >
          {t("login.forgot")}
        </Link>
      </div>
      <p className="border-t border-line pt-4 text-[13px] text-ink-2">
        <Link
          href={linkHref}
          className="underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink"
        >
          {t("login.useLink")}
        </Link>
      </p>
    </form>
  );
}
