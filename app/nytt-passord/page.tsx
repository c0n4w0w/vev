import type { Metadata } from "next";
import Link from "next/link";
import { resetPasswordAction, setPasswordAction } from "@/app/account-actions";
import { AccountShell } from "@/components/account/AccountShell";
import { PasswordForm } from "@/components/account/PasswordForm";
import { Panel, buttonClass } from "@/components/ui/primitives";
import { translator } from "@/lib/i18n";
import { accountPath } from "@/lib/account-locale";
import { authLocale } from "@/lib/account-locale-server";
import { LocaleProvider } from "@/lib/i18n/react";

export async function generateMetadata({ searchParams }: PageProps<"/nytt-passord">): Promise<Metadata> {
  return {
    title: translator(await authLocale((await searchParams).locale))("reset.metaTitle"),
    // The URL carries a single-use token. Never hand it to another site.
    referrer: "no-referrer",
  };
}

/**
 * Where a password-reset email leads.
 *
 * Opening the page spends nothing: it is only a form, and the link is used
 * when the form is submitted with a new password. A mail scanner or link
 * preview that fetches the URL therefore cannot use the link up, and nobody
 * is signed in by looking at it. The token is the only thing read from the
 * address — there is no destination in it to tamper with.
 *
 * Uses the language of the reset request when it is available in this browser.
 */
export default async function NewPasswordPage({ searchParams }: PageProps<"/nytt-passord">) {
  const { token_hash: tokenHashParam, locale: localeParam } = await searchParams;
  const tokenHash = typeof tokenHashParam === "string" && tokenHashParam ? tokenHashParam : undefined;
  const locale = await authLocale(localeParam);
  const t = translator(locale);
  const expired = {
    title: t("reset.invalid.title"),
    body: t("reset.invalid.body"),
    href: `/glemt-passord?neste=${encodeURIComponent(accountPath("/profile", locale))}`,
    action: t("reset.invalid.action"),
  };

  if (!tokenHash) {
    return (
      <AccountShell locale={locale}>
        <h1 className="font-display text-[1.75rem] leading-tight text-ink">{expired.title}</h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">{expired.body}</p>
        <Link href={expired.href} className={`${buttonClass()} mt-8`}>
          {expired.action}
        </Link>
      </AccountShell>
    );
  }

  return (
    <AccountShell locale={locale}>
      <p className="label">{t("reset.label")}</p>
      <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink">{t("reset.title")}</h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">{t("reset.lead")}</p>

      <Panel className="mt-8 p-5 sm:p-6">
        <LocaleProvider locale={locale}>
          <PasswordForm
            action={resetPasswordAction}
            fields={{ token_hash: tokenHash }}
            submitLabel={t("reset.submit")}
            expired={expired}
            // A good link signs the person in before the password is set. If
            // the password is then refused, the link is spent but the session
            // is not, and the second try goes through that.
            retry={{ action: setPasswordAction, fields: { next: "/home" } }}
          />
        </LocaleProvider>
      </Panel>
    </AccountShell>
  );
}
