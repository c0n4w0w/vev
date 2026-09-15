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
