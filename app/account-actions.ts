"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  cancelEmailChange,
  changePassword,
  confirmEmailChange,
  requestEmailChange,
  requestPasswordReset,
  resetPasswordWithLink,
  setPassword,
  signInWithPassword,
  type PasswordFailure,
} from "@/lib/account-security";
import type {
  EmailChangeFormState,
  EmailConfirmFormState,
  ForgotPasswordFormState,
  PasswordFormState,
  SignInFormState,
} from "@/lib/account-form";
import { acceptInvitationToken } from "@/lib/data";
import { parseLocale, tn, translator, type Locale, type Translator } from "@/lib/i18n";
import {
  checkNewPassword,
  EMAIL_CHANGE_COOLDOWN_HOURS,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  type PasswordProblem,
} from "@/lib/password";
import { safeInternalPath } from "@/lib/safe-path";

// Passwords arrive here in a form body and are handed straight to Supabase
// Auth. They are never logged, never put in a URL, and never sent back: a
// form that fails re-renders with its password fields empty.

/** The language a form was shown in. Presentation only; it decides nothing. */
function formLocale(formData: FormData): Locale {
  return parseLocale(formData.get("locale"));
}

function formTranslator(formData: FormData): Translator {
  return translator(formLocale(formData));
}

/** Seconds of waiting as whole minutes, never fewer than one. */
function minutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

/** A password exactly as typed — spaces are part of a passphrase. */
function passwordField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function looksLikeEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 254;
}

function problemMessage(t: Translator, problem: PasswordProblem): string {
  switch (problem) {
    case "too-short":
      return t("password.err.tooShort", { min: PASSWORD_MIN_LENGTH });
    case "too-long":
      return t("password.err.tooLong", { max: PASSWORD_MAX_BYTES });
    case "mismatch":
      return t("password.err.mismatch");
  }
}

function failureMessage(t: Translator, reason: PasswordFailure): string {
  switch (reason) {
    case "too-short":
      return t("password.err.tooShort", { min: PASSWORD_MIN_LENGTH });
    case "too-long":
      return t("password.err.tooLong", { max: PASSWORD_MAX_BYTES });
    case "pwned":
      return t("password.err.pwned");
    case "weak":
      return t("password.err.weak");
    case "same":
      return t("password.err.same");
    case "rate":
      return t("password.err.rate");
    case "unavailable":
      return t("password.err.unavailable");
    case "current":
      return t("password.err.current");
    case "reauth":
    case "failed":
      return t("password.err.failed");
  }
}

// ── Signing in ──────────────────────────────────────────────────────────

/**
 * Email and password. The sign-in link (`sendMagicLink`, app/actions.ts)
 * stays available beside it and signs into the same account.
 */
export async function signInWithPasswordAction(
  _prev: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  const t = formTranslator(formData);
  const email = String(formData.get("email") ?? "").trim();
  const password = passwordField(formData, "password");
  if (!email || !password) return { status: "error", message: t("login.err.missing"), email };

  const outcome = await signInWithPassword({ email, password });
  switch (outcome.status) {
    case "signed-in":
      revalidatePath("/", "layout");
      // Only ever a path on this site.
      redirect(safeInternalPath(String(formData.get("next") ?? "") || undefined));
    case "wait":
      // Said for any address after enough tries, whether or not it has an
      // account — and the emailed link is still there for whoever is waiting.
      return {
        status: "error",
        message: tn(formLocale(formData), "login.err.wait", minutes(outcome.seconds)),
        email,
      };
    case "rate":
      return { status: "error", message: t("login.err.rate"), email };
    case "unavailable":
      return { status: "error", message: t("password.err.unavailable"), email };
    case "credentials":
      return { status: "error", message: t("login.err.credentials"), email };
  }
}

// ── Forgotten password ──────────────────────────────────────────────────

/**
 * Sends a reset link. Says the same thing for every well-formed address,
 * because whether one has an account here is not for a stranger to learn.
 */
export async function requestPasswordResetAction(
  _prev: ForgotPasswordFormState,
  formData: FormData,
): Promise<ForgotPasswordFormState> {
  const t = formTranslator(formData);
  const email = String(formData.get("email") ?? "").trim();
  if (!looksLikeEmail(email)) return { status: "error", message: t("forgot.err.email"), email };

  const outcome = await requestPasswordReset(email);
  return outcome === "unavailable"
    ? { status: "error", message: t("password.err.unavailable"), email }
    : { status: "sent", email };
}

/**
 * The form a reset email opens: spends the link and sets the new password.
 *
 * A POST, deliberately — the page's GET only renders, so a mail scanner that
 * fetches the link uses nothing up. The password is checked before the link
 * is touched, so a typo does not cost the person their link.
 */
export async function resetPasswordAction(
  _prev: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const t = formTranslator(formData);
  const password = passwordField(formData, "password");
  const problem = checkNewPassword(password, passwordField(formData, "confirmation"));
  if (problem) return { status: "error", message: problemMessage(t, problem) };

  const outcome = await resetPasswordWithLink({
    tokenHash: String(formData.get("token_hash") ?? ""),
    password,
  });
  switch (outcome.status) {
    case "done":
      revalidatePath("/", "layout");
      redirect("/home");
    case "link-expired":
      return { status: "link-expired" };
    case "unavailable":
      return { status: "error", message: t("password.err.unavailable") };
    case "retry":
      revalidatePath("/", "layout");
      return { status: "retry", message: failureMessage(t, outcome.reason) };
  }
}

// ── Choosing and changing a password ────────────────────────────────────

function decodeToken(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Sets the signed-in account's password where no current one is asked for:
 * the step after an approval, "Opprett passord" under Sikkerhet, and the
 * second try after a reset link. `next` is where to go on — a path on this
 * site — because the page the form was on describes an account without a
 * password and is no longer true once this succeeds.
 */
export async function setPasswordAction(
  _prev: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const t = formTranslator(formData);
  const password = passwordField(formData, "password");
  const problem = checkNewPassword(password, passwordField(formData, "confirmation"));
  if (problem) return { status: "error", message: problemMessage(t, problem) };

  const outcome = await setPassword(password);
  if (outcome.ok) {
    revalidatePath("/", "layout");
    const next = safeInternalPath(String(formData.get("next") ?? "") || undefined);
    // Arriving from an invitation: the account now has what the invitation
    // was waiting for, so it is accepted here and the person lands in the
    // community rather than back on a page with one more button. Anything
    // the invitation refuses is for its own page to explain.
    const invitation = /^\/invitasjon\/([^/?#]+)$/.exec(next);
    if (invitation) {
      const accepted = await acceptInvitationToken(decodeToken(invitation[1]));
      if (accepted.ok) redirect(`/community/${accepted.communityId}`);
    }
    redirect(next);
  }
  switch (outcome.reason) {
    case "signed-out":
      redirect("/login");
    case "reauth":
      return { status: "reauth" };
    case "use-change":
      return { status: "error", message: t("password.err.useChange") };
    default:
      return { status: "error", message: failureMessage(t, outcome.reason) };
  }
}

export async function changePasswordAction(
  _prev: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const t = formTranslator(formData);
  const current = passwordField(formData, "current");
  const password = passwordField(formData, "password");
  if (!current) return { status: "error", message: t("password.err.current") };
  const problem = checkNewPassword(password, passwordField(formData, "confirmation"));
  if (problem) return { status: "error", message: problemMessage(t, problem) };

  const outcome = await changePassword({ current, next: password });
  if (outcome.ok) {
    revalidatePath("/", "layout");
    redirect(safeInternalPath(String(formData.get("next") ?? "") || undefined, "/profile"));
  }
  switch (outcome.reason) {
    case "signed-out":
      redirect("/login");
    case "wait":
      return {
        status: "error",
        message: tn(formLocale(formData), "password.err.wait", minutes(outcome.seconds)),
      };
    default:
      return { status: "error", message: failureMessage(t, outcome.reason) };
  }
}

// ── Changing the email address ──────────────────────────────────────────

/**
 * Asks for a confirmation to be sent to a new address. Needs the current
 * password every time, however recently the person signed in. The reply does
 * not say whether the address was free: a taken one answers like any other.
 */
export async function requestEmailChangeAction(
  _prev: EmailChangeFormState,
  formData: FormData,
): Promise<EmailChangeFormState> {
  const t = formTranslator(formData);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const currentPassword = passwordField(formData, "current");
  if (!looksLikeEmail(email)) {
    return { status: "error", message: t("security.changeEmail.err.email"), email };
  }
  if (!currentPassword) {
    return { status: "error", message: t("security.changeEmail.err.password"), email };
  }

  const outcome = await requestEmailChange({ currentPassword, newEmail: email });
  switch (outcome.status) {
    case "sent":
      revalidatePath("/profile");
      return { status: "sent", email };
    case "signed-out":
      redirect("/login");
    case "password":
      return { status: "error", message: t("security.changeEmail.err.password"), email };
    case "wait":
      return {
        status: "error",
        message: tn(formLocale(formData), "password.err.wait", minutes(outcome.seconds)),
        email,
      };
    case "invalid":
      return { status: "error", message: t("security.changeEmail.err.email"), email };
    case "same":
      return { status: "error", message: t("security.changeEmail.err.same"), email };
    case "no-password":
      return { status: "error", message: t("security.changeEmail.needsPassword.body"), email };
    case "cooldown":
      return {
        status: "error",
        message: t("security.changeEmail.err.cooldown", { hours: EMAIL_CHANGE_COOLDOWN_HOURS }),
        email,
      };
    case "rate":
      return { status: "error", message: t("security.changeEmail.err.rate"), email };
    case "unavailable":
      return { status: "error", message: t("password.err.unavailable"), email };
    case "failed":
      return { status: "error", message: t("security.changeEmail.err.failed"), email };
  }
}

/**
 * The button on the page the new address was sent. Pressing it, signed in as
 * the account, is what completes the change; opening the link does nothing.
 */
export async function confirmEmailChangeAction(
  _prev: EmailConfirmFormState,
  formData: FormData,
): Promise<EmailConfirmFormState> {
  const t = formTranslator(formData);
  const tokenHash = String(formData.get("token_hash") ?? "");

  const outcome = await confirmEmailChange(tokenHash);
  switch (outcome.status) {
    case "done":
      revalidatePath("/", "layout");
      // To a page that says so. The one the button was on re-renders with
      // nothing pending any more, so it cannot be the one to report success.
      redirect("/bekreft-e-post?endret=1");
    case "signed-out":
      redirect(
        `/login?neste=${encodeURIComponent(`/bekreft-e-post?token_hash=${encodeURIComponent(tokenHash)}`)}`,
      );
    case "none":
      return { status: "none" };
    case "half":
      return { status: "half" };
    case "expired":
      return { status: "error", message: t("confirmEmail.err.expired") };
    case "failed":
      return { status: "error", message: t("confirmEmail.err.failed") };
  }
}

export async function cancelEmailChangeAction(): Promise<void> {
  await cancelEmailChange();
  revalidatePath("/profile");
}
