/**
 * Environment access in one place, so a missing variable fails with a sentence
 * that says what to do rather than `undefined` deep inside a query.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Mangler miljøvariabelen ${name}. Kopier .env.example til .env.local og fyll inn verdiene fra Supabase-prosjektet.`,
    );
  }
  return value;
}

export function supabaseUrl() {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabaseAnonKey() {
  return required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/** Server-only. Bypasses row level security — never import from a Client Component. */
export function supabaseServiceRoleKey() {
  return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let warnedAboutSecretKey = false;

/**
 * Server-only, and optional: the `sb_secret_…` key that lets Supabase Auth be
 * told the caller's network address (lib/supabase/auth-forwarding.ts). It is
 * as powerful as the service role key and is used for nothing but that — it
 * accompanies requests to Auth's rate-limited endpoints and no others. No
 * `NEXT_PUBLIC_` prefix, so it is never inlined into a browser bundle.
 *
 * Unset, or not shaped like a secret key, means no forwarding and the app
 * behaves as it does without it. A value that is set but wrong is said once,
 * without repeating it.
 */
export function supabaseSecretKey(): string | undefined {
  const value = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!value) return undefined;
  if (/^sb_secret_[A-Za-z0-9_-]{8,}$/.test(value)) return value;
  if (!warnedAboutSecretKey) {
    warnedAboutSecretKey = true;
    console.error(
      "[auth-forwarding] SUPABASE_SECRET_KEY is set but is not a secret API key (sb_secret_…). " +
        "It is ignored; the legacy service_role key does not work for IP address forwarding.",
    );
  }
  return undefined;
}
