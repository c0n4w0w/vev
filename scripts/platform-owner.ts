/**
 * Appoints the first TING platform owner — or, as a documented recovery,
 * another owner when no owner can sign in any more.
 *
 *   npm run platform:owner -- --email navn@eksempel.no                       # tørrkjøring
 *   npm run platform:owner -- --email navn@eksempel.no --confirm             # første eier
 *   npm run platform:owner -- --email navn@eksempel.no --recover --confirm   # gjenoppretting
 *
 * Runs on the server, with the service-role key — whoever can run it already
 * holds the key that bypasses every rule, so it grants nothing they did not
 * have. It is the only way an owner comes into being without another owner,
 * and it is deliberately not reachable from the web: the database function
 * (platform_bootstrap_owner) can be executed by the service role alone.
 *
 * - Without --recover it refuses once any active owner exists, so it cannot
 *   quietly add owners to a running platform. The first person to register
 *   gets nothing: the account is named here, by the person running this.
 * - The account must already exist with a confirmed address and a password
 *   (the person signs up at /login and chooses a password under Kontoen din →
 *   Sikkerhet). It creates no account, sets no password and sends nothing.
 * - The owner still cannot use the dashboard until they set up a second
 *   factor, which the dashboard asks for on first visit.
 * - Both paths are recorded in the platform audit log (actor: system).
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { config } from "dotenv";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseUrl } from "@/lib/supabase/env";

config({ path: ".env.local" });
config({ path: ".env" });

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

const REASONS: Record<string, string> = {
  "invalid-input": "Adressen er ikke en e-postadresse.",
  "account-not-ready":
    "Ingen konto med bekreftet adresse og passord har denne adressen. Personen logger inn på /login med e-postlenke, og velger passord under Kontoen din → Sikkerhet først.",
  "owner-exists":
    "Plattformen har allerede en aktiv eier. Nye eiere utnevnes i dashbordet. Har ingen eier tilgang lenger, bruk --recover.",
};

async function main() {
  const email = argument("--email")?.trim().toLowerCase();
  const recover = process.argv.includes("--recover");
  if (!email) {
    console.error("Bruk: npm run platform:owner -- --email <adresse> [--recover] [--confirm]");
    process.exit(1);
  }

  const admin = createSupabaseAdminClient();
  console.log(`Database: ${new URL(supabaseUrl()).host}`);

  const { data: owners, error: ownersError } = await admin
    .from("platform_operators")
    .select("user_id")
    .eq("role", "owner")
    .is("revoked_at", null);
  if (ownersError) throw new Error(`Kunne ikke lese plattformadministratorene: ${ownersError.message}`);

  const what = recover
    ? `Gjenoppretting: ${email} blir plattformeier (aktive eiere nå: ${owners.length}).`
    : `${email} blir første plattformeier.`;

  if (!process.argv.includes("--confirm")) {
    if (!recover && owners.length > 0) {
      console.error(`✗ ${REASONS["owner-exists"]}`);
      process.exit(1);
    }
    console.log(`Tørrkjøring — ingenting endres. ${what}\nLegg til --confirm for å gjennomføre.`);
    return;
  }

  const { data, error } = await admin.rpc("platform_bootstrap_owner", { p_email: email, p_recovery: recover });
  if (error) {
    console.error(`✗ ${REASONS[error.message] ?? error.message}`);
    process.exit(1);
  }
  console.log(`✓ ${what} (konto ${data})`);
  console.log("  Personen går til /platform-admin etter innlogging og setter opp tofaktorinnlogging der.");
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
