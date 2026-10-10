/**
 * Removes disposable accounts made while demonstrating the new-member journey
 * locally — and nothing else.
 *
 *   npm run demo:cleanup-onboarding -- nora.demo1@example.com           (dry run)
 *   npm run demo:cleanup-onboarding -- nora.demo1@example.com --confirm (delete)
 *
 * The journey itself needs no preparation: every run uses a new address and
 * the real portal → approval → email → sign-in flow. This exists only so a
 * presenter can tidy up afterwards without editing the database by hand.
 *
 * Deliberately narrow:
 *   - local Supabase only (a loopback URL) and TING_MODE=demo, so it cannot
 *     reach the hosted showcase or production;
 *   - only addresses named on the command line — never a pattern, never "all";
 *   - only at example.com, a reserved domain no fixture or real person uses;
 *   - a dry run unless --confirm is given.
 *
 * For each address it removes that address's access requests and invitations
 * (with the notices they sent the administrators), the auth account (which cascades to its profile, memberships, community
 * profiles, notifications and messages), and any profile photos it uploaded.
 */
import { config } from "dotenv";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseUrl } from "@/lib/supabase/env";
import { assertDemoDeployment } from "@/lib/environment";

config({ path: ".env.local" });
config({ path: ".env" });

const DEMO_DOMAIN = "@example.com";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

async function main() {
  assertDemoDeployment("demo:cleanup-onboarding");
  const host = new URL(supabaseUrl()).hostname;
  if (!LOOPBACK.has(host)) {
    throw new Error(`Nekter: ${host} er ikke en lokal Supabase. Dette kjøres bare mot \`supabase start\`.`);
  }

  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const emails = [...new Set(args.filter((arg) => arg !== "--confirm").map((arg) => arg.trim().toLowerCase()))];
  if (emails.length === 0) {
    console.log("Bruk: npm run demo:cleanup-onboarding -- <adresse@example.com> [...] [--confirm]");
    return;
  }
  const refused = emails.filter((email) => !email.endsWith(DEMO_DOMAIN));
  if (refused.length) {
    throw new Error(`Nekter: bare demo-adresser på ${DEMO_DOMAIN} kan slettes (${refused.join(", ")}).`);
  }

  const admin = createSupabaseAdminClient();
  const { data: listed, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;

  for (const email of emails) {
    const user = listed.users.find((candidate) => candidate.email?.toLowerCase() === email);
    const { data: memberships } = user
      ? await admin.from("memberships").select("community_id, status").eq("user_id", user.id)
      : { data: [] };
    const { count: requests } = await admin
      .from("access_requests")
      .select("id", { count: "exact", head: true })
      .eq("email", email);

    const summary = [
      user ? "konto" : "ingen konto",
      `${memberships?.length ?? 0} medlemskap${memberships?.length ? ` (${memberships.map((m) => m.community_id).join(", ")})` : ""}`,
      `${requests ?? 0} forespørsler`,
    ].join(", ");

    if (!confirm) {
      console.log(`[tørrkjøring] ${email}: ${summary}`);
      continue;
    }

    // The "<name> ba om tilgang" notice each request sent the community's
    // administrators. Matched exactly on what the request trigger wrote.
    const { data: asked } = await admin
      .from("access_requests")
      .select("community_id, display_name, created_at")
      .eq("email", email);
    for (const request of asked ?? []) {
      await admin
        .from("notifications")
        .delete()
        .eq("community_id", request.community_id)
        .eq("kind", "membership")
        .eq("title", `${request.display_name ?? email} ba om tilgang`)
        .eq("href", `/community/${request.community_id}/requests`)
        .gte("created_at", request.created_at);
    }
    await admin.from("invitations").delete().eq("email", email);
    await admin.from("access_requests").delete().eq("email", email);
    if (user) {
      for (const { community_id } of memberships ?? []) {
        const folder = `${community_id}/${user.id}`;
        const { data: files } = await admin.storage.from("member-avatars").list(folder);
        const paths = (files ?? []).map((file) => `${folder}/${file.name}`);
        if (paths.length) await admin.storage.from("member-avatars").remove(paths);
      }
      const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
      if (deleteError) throw deleteError;
    }
    console.log(`Slettet ${email}: ${summary}`);
  }

  if (!confirm) console.log("\nIngenting er slettet. Kjør igjen med --confirm for å slette.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
