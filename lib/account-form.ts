/** What the account forms — sign-in, passwords, email change — report back. */

/**
 * `email` is what was typed, handed back so a refusal does not empty the
 * address along with the password. A password is never handed back.
 */
export type SignInFormState =
  | { status: "idle" }
  | { status: "error"; message: string; email?: string };

export const emptySignInFormState: SignInFormState = { status: "idle" };

export type PasswordFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  /** The session is too old to set a password; a fresh sign-in link is offered. */
  | { status: "reauth" }
  /** The emailed link is spent or expired. */
  | { status: "link-expired" }
  /**
   * The emailed link was good and the person is now signed in, but the
   * password itself was refused. The form carries on without the link.
   */
  | { status: "retry"; message: string };

export const emptyPasswordFormState: PasswordFormState = { status: "idle" };

export type ForgotPasswordFormState =
  | { status: "idle" }
  | { status: "error"; message: string; email?: string }
  /** Said whether or not the address has an account. */
  | { status: "sent"; email: string };

export const emptyForgotPasswordFormState: ForgotPasswordFormState = { status: "idle" };

export type EmailChangeFormState =
  | { status: "idle" }
  | { status: "error"; message: string; email?: string }
  /** Said whether or not the address could be used. */
  | { status: "sent"; email: string };

export const emptyEmailChangeFormState: EmailChangeFormState = { status: "idle" };

export type EmailConfirmFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  /** Nothing is waiting for the signed-in account. */
  | { status: "none" }
  /** The project asks both addresses to confirm, and the other has not yet. */
  | { status: "half" };

export const emptyEmailConfirmFormState: EmailConfirmFormState = { status: "idle" };
