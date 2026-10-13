import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cancelEmailChangeAction } from "@/app/account-actions";
import { EmailChangeForm } from "@/components/account/EmailChangeForm";
import { ButtonLink, PageContainer, PageHeader, Panel } from "@/components/ui/primitives";
import { getAccountSecurity } from "@/lib/account-security";
import { formatFullDate, formatTime } from "@/lib/format";
import { PLATFORM_LOCALE, translator } from "@/lib/i18n";
import { EMAIL_CHANGE_COOLDOWN_HOURS } from "@/lib/password";

const t = translator(PLATFORM_LOCALE);

export const metadata: Metadata = { title: t("security.changeEmail.metaTitle") };

/**
 * "Kontoen din" → "Sikkerhet" → e-postadresse.
 *
 * For the member whose old inbox is gone as much as for anyone else: what is
 * asked for is the password and the new inbox, never the old one. The account
 * stays the same account — only the address it signs in with moves — so every
 * membership, profile and conversation is where it was afterwards.
 *
 * What the page offers follows what the database will allow
 * (`authorize_email_change`): an account with no password is pointed at
 * creating one, and a password younger than a day is told when it will do.
 */
export default async function AccountEmailPage() {
  const security = await getAccountSecurity();
  if (!security) redirect("/login");

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={t("security.heading")}
        title={t("security.changeEmail.title")}
        lead={t("security.changeEmail.lead")}
      />

      <dl className="mb-6 text-sm">
        <dt className="label">{t("security.changeEmail.current")}</dt>
        <dd className="mt-1.5 text-ink [overflow-wrap:anywhere]">{security.email}</dd>
      </dl>

      {security.pendingEmail ? (
        <Panel className="mb-6 flex max-w-xl flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-[13px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
            {t("security.email.pending", { email: security.pendingEmail })}
          </p>
          <form action={cancelEmailChangeAction} className="shrink-0">
            <button
              type="submit"
              className="text-[13px] text-ink-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink"
            >
              {t("security.email.cancel")}
            </button>
          </form>
        </Panel>
      ) : null}

      {!security.hasPassword ? (
        <Panel className="max-w-xl p-5 sm:p-6">
          <h2 className="text-[0.9375rem] font-medium text-ink">
            {t("security.changeEmail.needsPassword.title")}
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
            {t("security.changeEmail.needsPassword.body")}
          </p>
          <ButtonLink href="/profile/passord" className="mt-4">
            {t("security.password.create")}
          </ButtonLink>
        </Panel>
      ) : security.emailChangeAvailableAt ? (
        <Panel className="max-w-xl p-5 sm:p-6">
          <h2 className="text-[0.9375rem] font-medium text-ink">
            {t("security.changeEmail.cooldown.title")}
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
            {t("security.changeEmail.cooldown.body", {
              hours: EMAIL_CHANGE_COOLDOWN_HOURS,
              date: formatFullDate(security.emailChangeAvailableAt),
              time: formatTime(security.emailChangeAvailableAt),
            })}
          </p>
        </Panel>
      ) : (
        <Panel className="max-w-xl p-5 sm:p-6">
          <EmailChangeForm currentEmail={security.email} />
        </Panel>
      )}

      <Link
        href="/profile"
        className="mt-8 inline-block text-[13px] text-ink-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink"
      >
        {t("security.back")}
      </Link>
    </PageContainer>
  );
}
