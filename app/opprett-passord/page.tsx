import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import { setPasswordAction } from "@/app/account-actions";
import { signOut } from "@/app/actions";
import { AccountShell } from "@/components/account/AccountShell";
import { PasswordForm } from "@/components/account/PasswordForm";
import { Panel } from "@/components/ui/primitives";
import { getAccountSecurity } from "@/lib/account-security";
import { getLocaleForDestination } from "@/lib/data";
import { resolveLocale, translator } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n/react";
import { safeInternalPath } from "@/lib/safe-path";

/** In the language of the community the person is on their way into. */
const localeForNext = cache(async (nextPath: string) =>
  resolveLocale({ community: await getLocaleForDestination(nextPath) }),
);

function nextParam(value: string | string[] | undefined) {
  return safeInternalPath(typeof value === "string" ? value : undefined);
}

export async function generateMetadata({
  searchParams,
}: PageProps<"/opprett-passord">): Promise<Metadata> {
  const locale = await localeForNext(nextParam((await searchParams).neste));
  return { title: translator(locale)("setup.metaTitle") };
}

/**
 * The step between signing in from an approval and the community: choose a
 * password.
 *
 * Someone arriving here from an invitation has proven the address but is not
 * a member yet: the database activates a membership only for an account with
 * a password (`accept_invitation_token`), so this is not a screen in front of
 * access they already have — there is none to reach around it. `neste` is the
 * invitation they came from, a path on this site or it is ignored, and once
 * the password is set the invitation is accepted and they land in the
 * community.
 *
 * Leaving and coming back is fine. The invitation stays good until it
 * expires, the link in the approval email leads back through here, and the
 * app sends an account that still owes a password here before anything else
 * (app/(app)/layout.tsx).
 */
export default async function PasswordSetupPage({ searchParams }: PageProps<"/opprett-passord">) {
  const nextPath = nextParam((await searchParams).neste);
  const here = `/opprett-passord?neste=${encodeURIComponent(nextPath)}`;

  const security = await getAccountSecurity();
  if (!security) redirect(`/login?neste=${encodeURIComponent(here)}`);
  if (security.hasPassword) redirect(nextPath);

  const locale = await localeForNext(nextPath);
  const t = translator(locale);

  return (
    <AccountShell locale={locale}>
      <p className="label">{t("setup.label")}</p>
      <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink">{t("setup.title")}</h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">{t("setup.lead")}</p>

      <Panel className="mt-8 p-5 sm:p-6">
        <LocaleProvider locale={locale}>
          <PasswordForm
            action={setPasswordAction}
            fields={{ next: nextPath }}
            email={security.email}
            submitLabel={t("setup.submit")}
            reauthNext={here}
          />
        </LocaleProvider>
      </Panel>

      {/* Sent here without the invitation in hand (signed in some other way):
          the password can be chosen now, and the email's link finishes the rest. */}
      {security.passwordSetupRequired && !nextPath.startsWith("/invitasjon/") ? (
        <p className="mt-4 text-[13px] leading-relaxed text-ink-3">{t("setup.resume")}</p>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-5 text-[13px] text-ink-3">
        <span className="[overflow-wrap:anywhere]">{t("setup.signedInAs", { email: security.email })}</span>
        <form action={signOut}>
          <button
            type="submit"
            className="text-ink-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink"
          >
            {t("setup.signOut")}
          </button>
        </form>
      </div>
    </AccountShell>
  );
}
