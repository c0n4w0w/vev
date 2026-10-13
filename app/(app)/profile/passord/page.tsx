import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { changePasswordAction, setPasswordAction } from "@/app/account-actions";
import { PasswordForm } from "@/components/account/PasswordForm";
import { PageContainer, PageHeader, Panel } from "@/components/ui/primitives";
import { getAccountSecurity } from "@/lib/account-security";
import { PLATFORM_LOCALE, translator } from "@/lib/i18n";

const t = translator(PLATFORM_LOCALE);

export const metadata: Metadata = { title: t("security.password") };

/**
 * "Kontoen din" → "Sikkerhet" → passord.
 *
 * One page, two situations. An account that has never chosen a password
 * creates one; nothing else about the account changes, and the sign-in link
 * goes on working. An account that has one changes it, and is asked for the
 * current password first.
 */
export default async function AccountPasswordPage() {
  const security = await getAccountSecurity();
  if (!security) redirect("/login");

  // Back to the account page, which then shows the password as it now is.
  const fields = { next: "/profile?passord=lagret" };
  const backLink = (
    <Link
      href="/profile"
      className="mt-8 inline-block text-[13px] text-ink-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink"
    >
      {t("security.back")}
    </Link>
  );

  if (!security.hasPassword) {
    return (
      <PageContainer width="narrow">
        <PageHeader
          eyebrow={t("security.heading")}
          title={t("security.createPassword.title")}
          lead={t("security.createPassword.lead")}
        />
        <Panel className="max-w-xl p-5 sm:p-6">
          <PasswordForm
            action={setPasswordAction}
            fields={fields}
            email={security.email}
            submitLabel={t("security.createPassword.submit")}
            reauthNext="/profile/passord"
          />
        </Panel>
        {backLink}
      </PageContainer>
    );
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow={t("security.heading")}
        title={t("security.changePassword.title")}
        lead={t("security.changePassword.lead")}
      />
      <Panel className="max-w-xl p-5 sm:p-6">
        <PasswordForm
          action={changePasswordAction}
          fields={fields}
          email={security.email}
          withCurrent
          submitLabel={t("security.changePassword.submit")}
        />
      </Panel>
      <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-ink-3">
        <Link
          href="/glemt-passord"
          className="underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink"
        >
          {t("security.changePassword.forgot")}
        </Link>
      </p>
      {backLink}
    </PageContainer>
  );
}
