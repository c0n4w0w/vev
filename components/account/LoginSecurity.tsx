"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { cancelEmailChangeAction, changePasswordAction, setPasswordAction } from "@/app/account-actions";
import { EmailChangeForm } from "@/components/account/EmailChangeForm";
import { PasswordForm } from "@/components/account/PasswordForm";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconClose } from "@/components/ui/icons";
import { Button, Panel, SectionHeading } from "@/components/ui/primitives";
import { accountPath } from "@/lib/account-locale";
import type { AccountSecurity } from "@/lib/account-security";
import { formatFullDate, formatTime } from "@/lib/format";
import { translator, type Locale } from "@/lib/i18n";
import { EMAIL_CHANGE_COOLDOWN_HOURS } from "@/lib/password";

type AccountDialog = "email" | "password" | "email-password" | null;

export function LoginSecurity({
  security,
  locale,
  edit,
  passwordSaved,
}: {
  security: AccountSecurity;
  locale: Locale;
  edit?: string | string[];
  passwordSaved: boolean;
}) {
  const t = translator(locale);
  const requestedDialog: AccountDialog =
    edit === "email" || edit === "password" || edit === "email-password" ? edit : null;
  const [dialog, setDialog] = useState<AccountDialog>(requestedDialog);
  const [source, setSource] = useState({ requestedDialog, passwordSetAt: security.passwordSetAt });
  const emailTrigger = useRef<HTMLButtonElement>(null);
  const passwordTrigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dialogOpen = dialog !== null;

  // Existing bookmarks and reauthentication links open the matching dialog.
  // A saved password returns here too: close its form, or resume the email
  // dialog when password creation began there. Keep the trigger nodes mounted.
  if (source.requestedDialog !== requestedDialog || source.passwordSetAt !== security.passwordSetAt) {
    setSource({ requestedDialog, passwordSetAt: security.passwordSetAt });
    setDialog(requestedDialog);
  }

  useEffect(() => {
    if (!dialog) return;
    returnFocus.current ??= dialog === "password" ? passwordTrigger.current : emailTrigger.current;
    heading.current?.focus();
  }, [dialog]);

  useEffect(() => {
    if (!dialogOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [dialogOpen]);

  function openDialog(next: Exclude<AccountDialog, null>, event: MouseEvent<HTMLButtonElement>) {
    returnFocus.current = event.currentTarget;
    setDialog(next);
  }

  function closeDialog() {
    setDialog(null);
    // ConfirmDialog also calls this after the native modal has closed, when
    // the trigger is no longer inert. This includes Escape and backdrop clicks.
    returnFocus.current?.focus();
  }

  const creatingForEmail = dialog === "email-password";
  const passwordPath = accountPath(`/profile?edit=${creatingForEmail ? "email-password" : "password"}#login`, locale);
  const passwordTitle = t(security.hasPassword ? "security.changePassword.title" : "security.createPassword.title");

  return (
    <section id="login" className="mt-7 scroll-mt-20">
      <SectionHeading>{t("security.heading")}</SectionHeading>
      {passwordSaved && security.hasPassword ? (
        <p role="status" className="mb-3 rounded-[5px] border border-skog/25 bg-skog-soft px-3 py-2 text-[13px] leading-relaxed text-skog">
          {t("security.password.saved")}
        </p>
      ) : null}
      <Panel className="divide-y divide-line">
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-ink">{t("security.email")}</h3>
            <p className="mt-1 text-[13px] text-ink-2 [overflow-wrap:anywhere]">{security.email}</p>
            {security.pendingEmail ? (
              <p className="mt-1 text-[13px] text-ink-2 [overflow-wrap:anywhere]">
                {t("security.email.pending", { email: security.pendingEmail })}
              </p>
            ) : null}
          </div>
          <Button
            ref={emailTrigger}
            type="button"
            variant="secondary"
            className="shrink-0"
            aria-label={t("security.email.change")}
            aria-haspopup="dialog"
            onClick={(event) => openDialog("email", event)}
          >
            {t("security.change")}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-ink">{t("security.password")}</h3>
            <p className="mt-1 text-[13px] text-ink-2">
              {t(security.hasPassword ? "security.password.configured" : "security.password.notConfigured")}
            </p>
          </div>
          <Button
            ref={passwordTrigger}
            type="button"
            variant="secondary"
            className="shrink-0"
            aria-haspopup="dialog"
            onClick={(event) => openDialog("password", event)}
          >
            {t(security.hasPassword ? "security.password.change" : "security.password.create")}
          </Button>
        </div>
      </Panel>

      <ConfirmDialog
        open={dialogOpen}
        onClose={closeDialog}
        labelledBy="account-security-title"
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain"
        trapFocus
      >
        {dialog ? (
          <div key={dialog}>
            <div className="sticky -top-5 z-10 -mx-5 -mt-5 mb-4 flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4">
              <h2 ref={heading} tabIndex={-1} id="account-security-title" className="rounded-sm font-display text-xl leading-snug text-ink">
                {dialog === "email" ? t("security.changeEmail.title") : passwordTitle}
              </h2>
              <Button type="button" variant="ghost" className="-mr-2 -mt-1 h-10 w-10 shrink-0 p-0" aria-label={t("common.close")} onClick={closeDialog}>
                <IconClose size={18} />
              </Button>
            </div>

            {dialog === "email" ? (
              <>
                {security.pendingEmail ? (
                  <div className="mb-4 border-b border-line pb-4 text-[13px] leading-relaxed text-ink-2">
                    <p className="[overflow-wrap:anywhere]">{t("security.email.pending", { email: security.pendingEmail })}</p>
                    <form action={cancelEmailChangeAction}>
                      <button type="submit" className="mt-1 min-h-10 rounded-sm underline decoration-line-2 underline-offset-4 hover:text-ink">
                        {t("security.email.cancel")}
                      </button>
                    </form>
                  </div>
                ) : null}
                {!security.hasPassword ? (
                  <>
                    <h3 className="text-sm font-medium text-ink">{t("security.changeEmail.needsPassword.title")}</h3>
                    <p className="mb-4 mt-1 text-[13px] leading-relaxed text-ink-2">
                      {t("security.changeEmail.needsPassword.body")}
                    </p>
                    <Button type="button" onClick={() => setDialog("email-password")}>
                      {t("security.password.create")}
                    </Button>
                  </>
                ) : security.emailChangeAvailableAt ? (
                  <>
                    <h3 className="text-sm font-medium text-ink">{t("security.changeEmail.cooldown.title")}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                      {t("security.changeEmail.cooldown.body", {
                        hours: EMAIL_CHANGE_COOLDOWN_HOURS,
                        date: formatFullDate(security.emailChangeAvailableAt, locale),
                        time: formatTime(security.emailChangeAvailableAt, locale),
                      })}
                    </p>
                  </>
                ) : (
                  <EmailChangeForm currentEmail={security.email} />
                )}
              </>
            ) : (
              <>
                <p className="mb-4 text-[13px] leading-relaxed text-ink-2">
                  {t(security.hasPassword ? "security.changePassword.lead" : "security.createPassword.lead")}
                </p>
                {security.passwordSetAt ? (
                  <p className="mb-4 text-xs text-ink-3">
                    {t("security.password.since", { date: formatFullDate(security.passwordSetAt, locale) })}
                  </p>
                ) : null}
                <PasswordForm
                  action={security.hasPassword ? changePasswordAction : setPasswordAction}
                  fields={{ next: accountPath(`/profile?${creatingForEmail ? "edit=email&" : ""}passord=lagret#login`, locale) }}
                  email={security.email}
                  withCurrent={security.hasPassword}
                  submitLabel={t(security.hasPassword ? "security.changePassword.submit" : "security.createPassword.submit")}
                  reauthNext={passwordPath}
                />
                {security.hasPassword ? (
                  <p className="mt-4 text-[13px] leading-relaxed text-ink-3">
                    <Link href={`/glemt-passord?neste=${encodeURIComponent(passwordPath)}`} className="rounded-sm underline decoration-line-2 underline-offset-4 hover:text-ink">
                      {t("security.changePassword.forgot")}
                    </Link>
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
