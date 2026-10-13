/**
 * Appoints the first administrator of a community.
 *
 *   npm run bootstrap:admin -- --community tryggere-ruspolitikk --email navn@eksempel.no
 *   npm run bootstrap:admin -- --community tryggere-ruspolitikk --email navn@eksempel.no --confirm
 *
 * Without --confirm it only says what it would do. The person must already
 * have made their own account at /login, confirmed the address and chosen a
 * password; this creates no account, sets no password and sends nothing. It
 * refuses if the community already has an administrator. The rules, and why,
 * are in lib/bootstrap/administrator.ts.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Run it on the
 * server; whoever can run it already holds the key that bypasses every rule.
 */
import { config } from "dotenv";
import { grantFirstAdministrator, planFirstAdministrator } from "@/lib/bootstrap/administrator";
import { isDemoDeployment } from "@/lib/environment";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseUrl } from "@/lib/supabase/env";

config({ path: ".env.local" });
config({ path: ".env" });

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function main() {
  const community = argument("--community");
  const email = argument("--email");
  if (!community || !email) {
    console.error("Bruk: npm run bootstrap:admin -- --community <slug> --email <adresse> [--confirm]");
    process.exit(1);
  }

  const admin = createSupabaseAdminClient();
  console.log(`Database: ${new URL(supabaseUrl()).host}`);

  const plan = await planFirstAdministrator(admin, { community, email, allowFixtures: isDemoDeployment() });
  if (!plan.ok) {
    console.error(`✗ ${plan.reason}`);
    process.exit(1);
  }
  if (plan.action === "none") {
    console.log(`✓ Kontoen er allerede administrator for ${plan.communityId}. Ingenting å gjøre.`);
    return;
  }

  const what =
    plan.action === "create"
      ? `Kontoen blir medlem og administrator av ${plan.communityId}.`
      : `Kontoens medlemskap i ${plan.communityId} blir aktivt, med rollen administrator.`;
  if (!process.argv.includes("--confirm")) {
    console.log(`Tørrkjøring — ingenting endres. ${what}\nLegg til --confirm for å gjennomføre.`);
    return;
  }

  const granted = await grantFirstAdministrator(admin, plan);
  if (!granted.ok) {
    console.error(`✗ ${granted.reason}`);
    process.exit(1);
  }
  console.log(`✓ ${what}`);
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
