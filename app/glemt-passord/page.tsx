import { getRequestLocale } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { AccountShell } from "@/components/account/AccountShell";
import { ForgotPasswordForm } from "@/components/account/ForgotPasswordForm";
import { Panel } from "@/components/ui/primitives";
import { getLocaleForDestination } from "@/lib/data";
import { translator } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n/react";
import { safeInternalPath } from "@/lib/safe-path";

/** Like the sign-in page: in the language of wherever the person was heading. */
const localeForNext = cache(async (nextPath: string) =>
  getRequestLocale(await getLocaleForDestination(nextPath)),
);

function nextParam(value: string | string[] | undefined) {
  return safeInternalPath(typeof value === "string" ? value : undefined);
}

export async function generateMetadata({
  searchParams,
}: PageProps<"/glemt-passord">): Promise<Metadata> {
  const locale = await localeForNext(nextParam((await searchParams).neste));
  return { title: translator(locale)("forgot.metaTitle") };
}

/**
 * Asks for a link to choose a new password.
 *
 * The link goes to the address the account signs in with, so this only helps
 * someone who can still read that inbox — and the page says so, rather than
 * leaving a person who has lost theirs waiting for an email that cannot reach
 * them. Their way back is the password they still know, and a new address.
 */
export default async function ForgotPasswordPage({ searchParams }: PageProps<"/glemt-passord">) {
  const nextPath = nextParam((await searchParams).neste);
  const locale = await localeForNext(nextPath);
  const t = translator(locale);

  return (
    <AccountShell locale={locale}>
      <p className="label">{t("forgot.label")}</p>
      <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink">{t("forgot.title")}</h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">{t("forgot.lead")}</p>

      <Panel className="mt-8 p-5 sm:p-6">
        <LocaleProvider locale={locale}>
          <ForgotPasswordForm />
        </LocaleProvider>
      </Panel>

      <p className="mt-6 text-[13px] leading-relaxed text-ink-3">{t("forgot.noInbox")}</p>
      <Link
        href={`/login?neste=${encodeURIComponent(nextPath)}`}
        className="mt-6 inline-block text-[13px] text-ink-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink"
      >
        {t("forgot.back")}
      </Link>
    </AccountShell>
  );
}
