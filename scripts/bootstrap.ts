/**
 * Sets up a real TING installation: the three organisations and their
 * permanent structure. No accounts, no members, no content.
 *
 *   npm run bootstrap                # dry run: what would be created
 *   npm run bootstrap -- --confirm   # create what is missing
 *
 * This is not the seed. `npm run seed` builds a showcase — sixteen invented
 * people, their posts and conversations — and refuses to run outside
 * `TING_MODE=demo`. This creates only what an organisation has before its
 * first member logs in (lib/bootstrap/definition.ts says exactly what), and
 * is the only one of the two meant for a production database.
 *
 * It adds what is missing and changes nothing that exists, so it can be run
 * again at any time; a row that differs from the definition is reported and
 * left alone. Run it after the migrations. The first administrator of each
 * community is appointed separately: `npm run bootstrap:admin`.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — run it where
 * the app runs, so it reads the same .env.local.
 */
import { config } from "dotenv";
import { applyBootstrap, summarizeInstallation } from "@/lib/bootstrap/apply";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseUrl } from "@/lib/supabase/env";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const write = process.argv.includes("--confirm");
  const admin = createSupabaseAdminClient();

  console.log(`Database: ${new URL(supabaseUrl()).host}`);
  console.log(write ? "Oppretter det som mangler …\n" : "Tørrkjøring — ingenting endres. Legg til --confirm for å opprette.\n");

  const report = await applyBootstrap(admin, { write });

  const verb = write ? "Opprettet" : "Ville opprettet";
  console.log(`${verb}: ${report.created.length}`);
  for (const line of report.created) console.log(`  + ${line}`);
  console.log(`\nFinnes allerede, som definert: ${report.present.length}`);
  if (report.differs.length > 0) {
    console.log(`\nFinnes allerede, men avviker fra definisjonen — latt i fred: ${report.differs.length}`);
    for (const line of report.differs) console.log(`  ≠ ${line}`);
  }
  if (report.corrected.length > 0) {
    console.log(`\n${write ? "Rettet" : "Ville rettet"} rekkefølgen på plattformoverskriftene: ${report.corrected.length}`);
    for (const line of report.corrected) console.log(`  → ${line}`);
  }
  if (report.skipped.length > 0) {
    console.log("\nIkke tatt med:");
    for (const line of report.skipped) console.log(`  – ${line}`);
  }

  if (!write) return;
  console.log("\nInstallasjonen nå:");
  for (const row of await summarizeInstallation(admin)) {
    console.log(
      `  ${row.community}: ${row.channels} kanaler, ${row.sections} kanalseksjoner, ${row.localGroups} lokallag, ${row.subgroups} grupper, ` +
        `${row.people} organisasjonspersoner, ${row.activeMembers} aktive medlemmer, ` +
        (row.hasAdministrator ? "har administrator" : "INGEN ADMINISTRATOR — se `npm run bootstrap:admin`"),
    );
  }
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
