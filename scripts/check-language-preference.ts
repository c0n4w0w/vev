/** Account locale persistence, isolation and resolver priority on the local stack. */
import { config } from "dotenv";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { resolveLocale } from "@/lib/i18n";
import { formatFullDate } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local", quiet: true });
const url = supabaseUrl();
assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname), "Use the local stack for disposable accounts");
const admin = createSupabaseAdminClient();
const fresh = () => createClient<Database>(url, supabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
const created: string[] = [];
let checks = 0;
function equal(actual: unknown, expected: unknown, label: string) {
  assert.deepEqual(actual, expected, label);
  checks++;
}

async function account(label: string) {
  const email = `check.language.${label}.${randomUUID().slice(0, 8)}@demo.join-ting.no`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  assert.ifError(error);
  const id = data.user!.id;
  created.push(id);
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  assert.ifError(linkError);
  const client = fresh();
  const verified = await client.auth.verifyOtp({ type: "email", token_hash: link!.properties.hashed_token });
  assert.ifError(verified.error);
  const password = `Language check ${randomUUID()}`;
  assert.ifError((await client.auth.updateUser({ password })).error);
  return { id, email, password, client };
}

async function main() {
  const owner = await account("owner");
  const other = await account("other");
  const before = (await owner.client.from("profiles").select("*").eq("id", owner.id).single()).data!;
  equal(before.preferred_locale, null, "A new account has no explicit preference");
  equal(resolveLocale({ community: "en" }), "en", "UTR default remains English without a preference");
  equal(resolveLocale({ community: "nb" }), "nb", "Norwegian communities keep their default");
  equal(resolveLocale({}), "nb", "The platform default is unchanged");
  equal(resolveLocale({ user: "nb", community: "en" }), "nb", "Explicit Norwegian overrides English communities");
  equal(resolveLocale({ user: "en", community: "nb" }), "en", "Explicit English overrides Norwegian communities");
  equal(formatFullDate("2026-10-21T12:00:00Z", "en"), "21 October 2026", "English dates");
  equal(formatFullDate("2026-10-21T12:00:00Z", "nb"), "21. oktober 2026", "Norwegian dates");
  equal(Boolean((await fresh().rpc("set_my_locale", { p_locale: "en" })).error), true, "Anonymous changes are refused");
  equal(Boolean((await owner.client.rpc("set_my_locale", { p_locale: "invalid" })).error), true, "Unsupported values are refused");
  equal(Boolean((await owner.client.rpc("set_my_locale", { p_locale: null as unknown as string })).error), true, "Null cannot erase an explicit choice through the setter");
  equal(Boolean((await owner.client.from("profiles").update({ preferred_locale: "en" }).eq("id", owner.id)).error), true, "Direct account writes remain locked");
  equal((await owner.client.rpc("set_my_locale", { p_locale: "en" })).data, "en", "The owner can choose English");
  const after = (await owner.client.from("profiles").select("*").eq("id", owner.id).single()).data!;
  equal(after, { ...before, preferred_locale: "en" }, "Only the locale changes, never identity or account data");
  equal((await other.client.from("profiles").select("preferred_locale").eq("id", other.id).single()).data?.preferred_locale, null, "Another account is unchanged");
  equal((await other.client.from("profiles").select("preferred_locale").eq("id", owner.id)).data, [], "Another account cannot read the preference");
  equal(Boolean((await other.client.from("profiles").update({ preferred_locale: "nb" }).eq("id", owner.id)).error), true, "Another account cannot write it");
  const device = fresh();
  assert.ifError((await device.auth.signInWithPassword({ email: owner.email, password: owner.password })).error);
  equal((await device.from("profiles").select("preferred_locale").eq("id", owner.id).single()).data?.preferred_locale, "en", "The preference survives a fresh session on another client");
  equal((await device.rpc("set_my_locale", { p_locale: "nb" })).data, "nb", "The second device can choose Norwegian");
  equal((await owner.client.from("profiles").select("preferred_locale").eq("id", owner.id).single()).data?.preferred_locale, "nb", "The first session reads the second device's choice");
  assert.ifError((await device.auth.signOut({ scope: "local" })).error);
  assert.ifError((await device.auth.signInWithPassword({ email: owner.email, password: owner.password })).error);
  equal((await device.from("profiles").select("preferred_locale").eq("id", owner.id).single()).data?.preferred_locale, "nb", "Logging out and back in preserves the account choice");
  if (process.env.KEEP_LANGUAGE_FIXTURE === "1") {
    assert.ifError((await admin.from("profiles").update({ preferred_locale: null }).eq("id", owner.id)).error);
    assert.ifError((await admin.from("memberships").insert(["under-the-rug", "tryggere-ruspolitikk"].map(community_id => ({ community_id, user_id: owner.id, role: "member", status: "active" })))).error);
    writeFileSync("/tmp/vev-language-ui.json", JSON.stringify({ id: owner.id, email: owner.email, password: owner.password }), { mode: 0o600 });
    created.splice(created.indexOf(owner.id), 1);
  }
  console.log(`✓ ${checks} language preference checks passed`);
}

main().finally(async () => {
  for (const id of created) assert.ifError((await admin.auth.admin.deleteUser(id)).error);
}).catch(error => { console.error(error); process.exitCode = 1; });
