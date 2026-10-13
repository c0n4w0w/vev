/**
 * What TING asks of a password, as feedback before anything is sent.
 *
 * Supabase Auth is what enforces these — `auth.minimum_password_length` and
 * its own 72-byte ceiling (bcrypt reads no further) — and it is Auth that
 * stores and verifies the password. This only lets a form say what is wrong
 * without a round trip, in the same terms. Length is the whole policy: no
 * rules about which characters, because a long passphrase is stronger than a
 * short password with a symbol in it, and easier to remember.
 *
 * Pure on purpose, so the checks can exercise it without a database.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;

export type PasswordProblem = "too-short" | "too-long" | "mismatch";

/**
 * The first thing wrong with a new password, or null. The password is taken
 * exactly as typed: spaces count, and nothing is trimmed.
 */
export function checkNewPassword(password: string, confirmation: string): PasswordProblem | null {
  // Characters as a person counts them, so «æøå» is three, not six.
  if ([...password].length < PASSWORD_MIN_LENGTH) return "too-short";
  // Auth measures the ceiling in bytes.
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return "too-long";
  if (password !== confirmation) return "mismatch";
  return null;
}

/**
 * How long a password must have existed before it can authorise an email
 * change. Mirrors `public.email_change_cooldown()`, which is the rule that is
 * enforced; this copy only lets a page say when. `npm run
 * check:account-security` fails if the two differ.
 */
export const EMAIL_CHANGE_COOLDOWN_HOURS = 24;
