import type { Metadata } from "next";
import Link from "next/link";
import { AccountShell } from "@/components/account/AccountShell";
import { ConfirmEmailChange } from "@/components/account/ConfirmEmailChange";
import { buttonClass } from "@/components/ui/primitives";
import { getAccountSecurity } from "@/lib/account-security";
import { PLATFORM_LOCALE, translator } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n/react";

export const metadata: Metadata = {
  title: translator(PLATFORM_LOCALE)("confirmEmail.metaTitle"),
  // The URL carries a single-use token. Never hand it to another site.
  referrer: "no-referrer",
};

/**
 * Where the confirmation sent to a new email address leads.
 *
 * The link proves the new inbox; it does not prove who is holding it. So the
 * page changes nothing by being opened, and the button on it works only for
 * the account that asked for the change, signed in. Someone who received the
 * email by mistake finds a page asking them to log in to an account they do
 * not have. The old address is not needed for any of this.
 */
export default async function ConfirmEmailPage({ searchParams }: PageProps<"/bekreft-e-post">) {
  const { token_hash: tokenHashParam, endret } = await searchParams;
  const tokenHash = typeof tokenHashParam === "string" && tokenHashParam ? tokenHashParam : undefined;
  const locale = PLATFORM_LOCALE;
  const t = translator(locale);

  // Where the button lands once the change has gone through. The page reports
  // only what the session says — the address the account signs in with now —
  // so opening this address by hand shows nothing that is not already true.
  if (endret === "1" && !tokenHash) {
    const account = await getAccountSecurity();
    if (account) {
      return (
        <AccountShell locale={locale}>
          <p className="label">{t("confirmEmail.label")}</p>
          <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink">
            {t("confirmEmail.done.title")}
          </h1>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
            {t("confirmEmail.done.body", { email: account.email })}
          </p>
          <Link href="/profile" className={`${buttonClass({ variant: "secondary" })} mt-8`}>
            {t("confirmEmail.toAccount")}
          </Link>
        </AccountShell>
      );
    }
  }

  if (!tokenHash) {
    return (
      <AccountShell locale={locale}>
        <h1 className="font-display text-[1.75rem] leading-tight text-ink">
          {t("confirmEmail.invalid.title")}
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">{t("confirmEmail.invalid.body")}</p>
        <Link href="/profile" className={`${buttonClass({ variant: "secondary" })} mt-8`}>
          {t("confirmEmail.toAccount")}
        </Link>
      </AccountShell>
    );
  }

  const security = await getAccountSecurity();
  const here = `/bekreft-e-post?token_hash=${encodeURIComponent(tokenHash)}`;

  return (
    <AccountShell locale={locale}>
      <p className="label">{t("confirmEmail.label")}</p>
      <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink">{t("confirmEmail.title")}</h1>

      {!security ? (
        <>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">{t("confirmEmail.signIn.body")}</p>
          <Link href={`/login?neste=${encodeURIComponent(here)}`} className={`${buttonClass()} mt-8`}>
            {t("confirmEmail.signIn.action")}
          </Link>
        </>
      ) : !security.pendingEmail ? (
        <>
          <p className="mt-3 text-[0.9375rem] font-medium text-ink">{t("confirmEmail.none.title")}</p>
          <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
            {t("confirmEmail.none.body", { email: security.email })}
          </p>
          <Link href="/profile" className={`${buttonClass({ variant: "secondary" })} mt-8`}>
            {t("confirmEmail.toAccount")}
          </Link>
        </>
      ) : (
        <>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
            {t("confirmEmail.lead", { email: security.pendingEmail })}
          </p>
          <div className="mt-8">
            <LocaleProvider locale={locale}>
              <ConfirmEmailChange tokenHash={tokenHash} signedInEmail={security.email} />
            </LocaleProvider>
          </div>
        </>
      )}
    </AccountShell>
  );
}
