/**
 * Checks the platform administration layer end to end, as real callers.
 *
 *   npm run check:platform-admin
 *
 * Everything runs against a disposable cast it creates itself — accounts with
 * passwords and TOTP factors, communities, a request — and removes again at
 * the end. It needs no seed. It does leave entries in platform_audit_log,
 * which is append-only by design: run it against a throwaway stack (see
 * docs/platform-admin.md, "Tester"), not a database whose audit history
 * matters. Never against production.
 *
 * Environment: the usual NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 * and SUPABASE_SERVICE_ROLE_KEY (env wins over .env.local), plus
 *   SUPABASE_DB_CONTAINER   the local database container (default supabase_db_vev)
 *   APP_URL                 the running app for the page checks (default http://localhost:3000);
 *                           unreachable → those checks are reported as skipped, not passed
 *
 * The service role is used only to create and remove the cast, to read rows
 * back for comparison, and where a check is about the service role itself.
 * Every permission check goes through the anon key with a real session.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_vev";

type Client = SupabaseClient<Database>;
const admin: Client = createClient<Database>(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

let checks = 0;
let failures = 0;
let skipped = 0;
const RUN = randomBytes(3).toString("hex");

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

function skip(label: string, why: string) {
  skipped += 1;
  console.warn(`- hoppet over: ${label} (${why})`);
}

/** The error code a platform function raised, or "ok". */
function outcome(result: { error: { message?: string; code?: string } | null }): string {
  if (!result.error) return "ok";
  return result.error.message ?? result.error.code ?? "error";
}

/** 42501-style refusals from the API gateway or Postgres grants. */
function denied(result: { error: { message?: string; code?: string } | null }): boolean {
  if (!result.error) return false;
  return (
    result.error.code === "42501" ||
    /permission denied|not allowed|platform-forbidden/i.test(result.error.message ?? "") ||
    result.error.code === "PGRST202" // function not exposed to this role
  );
}

const sql = (statement: string) =>
  execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-AtX", "-v", "ON_ERROR_STOP=1", "-c", statement], {
    stdio: ["ignore", "pipe", "pipe"],
  })
    .toString()
    .trim();

/** Runs SQL and returns the error text instead of throwing. */
function sqlError(statement: string): string {
  try {
    sql(statement);
    return "ok";
  } catch (error) {
    const text = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
    return text.split("\n").find((line) => line.startsWith("ERROR"))?.replace(/^ERROR:\s+/, "") ?? text;
  }
}

// ── TOTP (RFC 6238), so the suite can pass a second factor itself ─────────

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) continue;
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

const secrets = new Map<string, string>();

async function waitForNextWindow() {
  const wait = 30_000 - (Date.now() % 30_000) + 500;
  await new Promise((resolve) => setTimeout(resolve, wait));
}

/** Verifies the client's TOTP factor; retries once in the next window (a code is single-use). */
async function verifyMfa(client: Client, email: string): Promise<void> {
  const { data: factors } = await client.auth.mfa.listFactors();
  const factor = factors?.totp.find((entry) => entry.status === "verified");
  if (!factor) throw new Error(`${email}: ingen verifisert faktor`);
  const secret = secrets.get(email)!;
  let { error } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(secret) });
  if (error) {
    await waitForNextWindow();
    ({ error } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(secret) }));
  }
  if (error) throw new Error(`${email}: MFA-verifisering feilet: ${error.message}`);
}

async function enrollMfa(client: Client, email: string): Promise<void> {
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `qa ${RUN}` });
  if (error || !data) throw new Error(`${email}: kunne ikke registrere TOTP: ${error?.message}`);
  secrets.set(email, data.totp.secret);
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({ factorId: data.id, code: totp(data.totp.secret) });
  if (verifyError) throw new Error(`${email}: kunne ikke bekrefte TOTP: ${verifyError.message}`);
}

// ── The cast ─────────────────────────────────────────────────────────────

const created = { users: [] as string[], communities: [] as string[], requests: [] as string[] };
const PASSWORD = `Qa-${randomBytes(12).toString("hex")}`;

async function account(label: string, options: { password?: boolean; confirmed?: boolean } = {}) {
  const email = `qa-platform-${label}-${RUN}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: options.confirmed ?? true });
  if (error || !data.user) throw new Error(`kunne ikke lage ${label}: ${error?.message}`);
  created.users.push(data.user.id);
  if (options.password ?? true) {
    const { error: passwordError } = await admin.auth.admin.updateUserById(data.user.id, { password: PASSWORD });
    if (passwordError) throw new Error(`kunne ikke sette passord for ${label}: ${passwordError.message}`);
  }
  return { id: data.user.id, email };
}

function anonymous(): Client {
  return createClient<Database>(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(email: string): Promise<Client> {
  const client = anonymous();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`${email}: innlogging feilet: ${error.message}`);
  return client;
}

/** A client that signs in through an emailed link — for an account with no password. */
async function signInWithLink(email: string): Promise<Client> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties) throw new Error(`${email}: lenke feilet: ${error?.message}`);
  const client = anonymous();
  const { error: verifyError } = await client.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
  if (verifyError) throw new Error(`${email}: lenke kunne ikke brukes: ${verifyError.message}`);
  return client;
}

function communityArgs(id: string, overrides: Partial<Database["public"]["Functions"]["platform_create_community"]["Args"]> = {}) {
  return {
    p_id: id,
    p_slug: id,
    p_name: `QA ${id}`,
    p_tagline: "Testfellesskap",
    p_public_description: "Opprettet av check:platform-admin.",
    p_location: "Oslo",
    p_founded_year: 2020,
    p_accent: "#1f4a3d",
    p_accent_soft: "#e3eae7",
    p_monogram: "QA",
    p_mark_style: "sans",
    p_access_policy: "request-to-join" as const,
    p_default_locale: "nb",
    p_member_directory_visibility: "admin_only" as const,
    p_dm_policy: "members" as const,
    p_admin_email: "",
    p_onboarding_request_id: null as unknown as string,
    p_creation_key: randomUUID(),
    ...overrides,
  };
}

// ── Pages, over HTTP, with the app's own cookies ─────────────────────────

async function cookieHeader(client: Client | null): Promise<string> {
  if (!client) return "";
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session) return "";
  const jar = new Map<string, string>();
  const server = createServerClient(URL_, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  await server.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

let appReachable: boolean | null = null;
async function page(path: string, client: Client | null) {
  if (appReachable === null) {
    appReachable = await fetch(APP_URL, { redirect: "manual" })
      .then(() => true)
      .catch(() => false);
  }
  if (!appReachable) return null;
  const response = await fetch(`${APP_URL}${path}`, { headers: { cookie: await cookieHeader(client) }, redirect: "manual" });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

// ── The checks ───────────────────────────────────────────────────────────

async function main() {
  if (!URL_ || !ANON || !SERVICE) throw new Error("Mangler Supabase-miljøvariabler.");
  if (/supabase\.co/.test(URL_)) throw new Error("Denne sjekken kjøres bare mot en lokal stakk.");
  console.log(`Database: ${new URL(URL_).host} · app: ${APP_URL} · kjøring ${RUN}`);

  // ── The catalog: nothing grants anything from a suspended community ─────
  //
  // A boolean function that grants something from an active membership must
  // also ask is_community_suspended(). The ones listed are not grants: they
  // write (and the suspension triggers refuse the write), or they report the
  // caller's own settings. A later migration that redefines a predicate and
  // drops the condition fails here.
  const notGrants = new Set([
    "add_local_group_manager", "add_private_channel_participant", "add_subgroup_member", "dismiss_my_onboarding",
    "my_accepts_member_dms", "my_onboarding_visible", "platform_remove_community_admin", "set_accepts_member_dms",
    "set_community_person_user", "set_membership_role", "set_my_local_group", "set_subgroup_manager",
  ]);
  const unguarded = sql(
    `select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prorettype = 'bool'::regtype
        and p.prosrc ~ 'memberships' and p.prosrc ~ $$status = 'active'$$ and p.prosrc !~ 'is_community_suspended'`,
  )
    .split(",")
    .filter((name) => name && !notGrants.has(name));
  expect("katalog: alle medlemskapspredikater spør om suspensjon", unguarded.join(", "), "");
  const gates = [
    "is_community_suspended", "is_member", "is_admin", "can_moderate", "can_view_member_directory", "content_scope_admits",
    "channel_access_admits", "private_channel_access_admits", "private_channel_create_admits", "private_channel_manage_admits",
    "subgroup_access_admits", "subgroup_create_admits", "subgroup_manage_admits", "local_group_manage_admits",
    "can_lead_local_group", "can_manage_subgroup", "can_send_dm", "community_identity_admits", "can_view_community_profile",
    "reaction_authors_admit", "platform_require",
  ].join("|");
  expect(
    "katalog: hver API-funksjon som leser medlemskap går gjennom et slikt predikat",
    sql(
      `select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p
        where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')
          and p.prorettype <> 'bool'::regtype and p.prosrc ~ 'memberships'
          and p.proname <> 'my_suspended_community_ids'
          and p.prosrc !~ $$(${gates})\\($$`,
    ),
    "",
  );
  expect(
    "katalog: hver fellesskapstabell har suspensjonstriggeren",
    sql(
      `select coalesce(string_agg(c.relname, ',' order by c.relname), '') from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          and exists (select 1 from pg_attribute a where a.attrelid = c.oid and not a.attisdropped
                      and a.attname in ('community_id', 'channel_id', 'conversation_id', 'post_id', 'message_id', 'event_id', 'poll_id', 'direct_message_id'))
          and c.relname not like 'collaboration%'
          and c.relname not in ('notifications', 'published_collaboration_events', 'platform_onboarding_requests', 'community_platform_state')
          and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname like '%_refuse_when_suspended')`,
    ),
    "",
  );

  // Accounts.
  const owner = await account("owner");
  const operator = await account("operator");
  const ordinary = await account("ordinary");
  const communityAdmin = await account("cadmin");
  const moderator = await account("moderator");
  const noPassword = await account("nopassword", { password: false });
  const unconfirmed = await account("unconfirmed", { confirmed: false, password: false });
  const stranger = await account("stranger");

  expect("oppsett: passord registrert for testkontoen", sql(`select public.account_has_password('${owner.id}')`), "t");

  // ── Bootstrap: the first owner, from the server only ──────────────────
  const anon = anonymous();
  const ordinaryClient = await signIn(ordinary.email);
  expect(
    "bootstrap: en vanlig innlogget konto kan ikke kalle platform_bootstrap_owner",
    denied(await ordinaryClient.rpc("platform_bootstrap_owner", { p_email: ordinary.email, p_recovery: true })),
    true,
  );
  expect(
    "bootstrap: anonym kan ikke kalle platform_bootstrap_owner",
    denied(await anon.rpc("platform_bootstrap_owner", { p_email: ordinary.email, p_recovery: true })),
    true,
  );
  expect(
    "bootstrap: en konto uten passord kan ikke bli eier",
    outcome(await admin.rpc("platform_bootstrap_owner", { p_email: noPassword.email, p_recovery: false })),
    "account-not-ready",
  );
  const existingOwners = Number(sql(`select count(*) from platform_operators where role = 'owner' and revoked_at is null`));
  const boot = await admin.rpc("platform_bootstrap_owner", { p_email: owner.email, p_recovery: existingOwners > 0 });
  expect("bootstrap: serverens nøkkel utnevner første eier", outcome(boot), "ok");
  expect(
    "bootstrap: uten --recover nektes en ny eier når en finnes",
    outcome(await admin.rpc("platform_bootstrap_owner", { p_email: stranger.email, p_recovery: false })),
    "owner-exists",
  );
  expect(
    "bootstrap: registrert i revisjonsloggen som system",
    sql(`select count(*) from platform_audit_log where action in ('platform_operator.bootstrap','platform_operator.recover') and target_id = '${owner.id}' and actor_role = 'system'`),
    1,
  );

  // ── 15. MFA: an operator without AAL2 can do nothing ──────────────────
  const ownerClient = await signIn(owner.email);
  expect("mfa: eier uten verifisert faktor (aal1) får platform-mfa-required", outcome(await ownerClient.rpc("platform_overview")), "platform-mfa-required");
  const access1 = await ownerClient.rpc("my_platform_access");
  expect("mfa: my_platform_access sier rolle men ikke verifisert", `${access1.data?.[0]?.role}/${access1.data?.[0]?.mfa_verified}`, "owner/false");
  expect(
    "mfa: eier uten aal2 kan ikke opprette fellesskap",
    outcome(await ownerClient.rpc("platform_create_community", communityArgs(`qa-nomfa-${RUN}`))),
    "platform-mfa-required",
  );
  await enrollMfa(ownerClient, owner.email);
  expect("mfa: etter verifisert TOTP svarer platform_overview", outcome(await ownerClient.rpc("platform_overview")), "ok");

  // Operator, appointed by the owner (fresh MFA — just verified).
  expect(
    "operatør: eier utnevner med fersk MFA",
    outcome(await ownerClient.rpc("platform_appoint_operator", { p_email: operator.email, p_role: "operator" })),
    "ok",
  );
  expect(
    "operatør: eier kan ikke utnevne seg selv",
    outcome(await ownerClient.rpc("platform_appoint_operator", { p_email: owner.email, p_role: "operator" })),
    "self",
  );
  expect(
    "operatør: en konto uten passord kan ikke utnevnes",
    outcome(await ownerClient.rpc("platform_appoint_operator", { p_email: noPassword.email, p_role: "operator" })),
    "account-not-ready",
  );
  const operatorClient = await signIn(operator.email);
  expect("mfa: operatør uten verifisert faktor får platform-mfa-required", outcome(await operatorClient.rpc("platform_list_communities", {})), "platform-mfa-required");
  await enrollMfa(operatorClient, operator.email);
  expect("mfa: operatør med aal2 får liste fellesskap", outcome(await operatorClient.rpc("platform_list_communities", {})), "ok");

  // A signed-out session's token is not good enough for platform work.
  {
    const throwaway = await signIn(operator.email);
    await verifyMfa(throwaway, operator.email);
    const { data } = await throwaway.auth.getSession();
    const token = data.session!.access_token;
    await throwaway.auth.signOut({ scope: "local" });
    const replay = createClient<Database>(URL_, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    expect("mfa: en utlogget sesjons token avvises", outcome(await replay.rpc("platform_overview")), "platform-forbidden");
  }

  // ── Provisioning ────────────────────────────────────────────────────────
  const communityId = `qa-plattform-${RUN}`;
  created.communities.push(communityId);
  const createArgs = communityArgs(communityId, { p_admin_email: communityAdmin.email });
  const create = await operatorClient.rpc("platform_create_community", createArgs);
  expect("opprett: operatør oppretter fellesskap", outcome(create), "ok");
  expect("opprett: ny administrator med passord utnevnes med en gang", create.data?.[0]?.admin_outcome, "assigned");
  expect("opprett: ingen token returneres for en eksisterende konto", create.data?.[0]?.admin_token ?? "null", "null");

  // 7. The records a working community needs.
  expect("opprett: fellesskapsraden finnes", sql(`select count(*) from communities where id = '${communityId}'`), 1);
  expect(
    "opprett: plattformraden har status, tidspunkt, opprettet av og nøkkel",
    sql(`select status || '/' || (provisioned_at is not null) || '/' || (provisioned_by = '${operator.id}') || '/' || (creation_key = '${createArgs.p_creation_key}') from community_platform_state where community_id = '${communityId}'`),
    "active/true/true/true",
  );
  expect(
    "opprett: administratoren er aktivt medlem med rollen admin",
    sql(`select role || '/' || status from memberships where community_id = '${communityId}' and user_id = '${communityAdmin.id}'`),
    "admin/active",
  );
  expect("opprett: administratorens fellesskapsprofil er laget", sql(`select count(*) from community_profiles where community_id = '${communityId}' and user_id = '${communityAdmin.id}'`), 1);
  expect("opprett: ingen operatør er gjort til medlem", sql(`select count(*) from memberships where community_id = '${communityId}' and user_id in ('${owner.id}','${operator.id}')`), 0);
  expect(
    "opprett: trygge standardvalg lagres som oppgitt",
    sql(`select member_directory_visibility || '/' || access_policy from communities where id = '${communityId}'`),
    "admin_only/request-to-join",
  );
  expect(
    "opprett: plattformoverskriftene for lokallag og grupper finnes",
    sql(`select count(*) from channel_groups where id in ('lokallag','grupper')`),
    2,
  );
  const adminClient = await signIn(communityAdmin.email);
  const channel = await adminClient.rpc("create_community_channel", {
    p_community_id: communityId,
    p_name: "generelt",
    p_purpose: "Testkanal",
    p_section_id: null as unknown as string,
    p_creation_key: randomUUID(),
    p_read_only: false,
    p_file_sharing: false,
  });
  expect("opprett: administratoren kan sette opp fellesskapet (lage kanal)", outcome(channel), "ok");
  const channelId = sql(`select id from channels where community_id = '${communityId}' and local_group_id is null and subgroup_id is null limit 1`);
  expect("opprett: kanalen finnes", channelId.length > 0, true);

  // 8. Duplicate submissions and duplicate identifiers.
  const again = await operatorClient.rpc("platform_create_community", createArgs);
  expect("duplikat: samme skjema to ganger gir samme fellesskap", `${outcome(again)}/${again.data?.[0]?.created}/${again.data?.[0]?.community_id}`, `ok/false/${communityId}`);
  expect("duplikat: fortsatt bare én rad", sql(`select count(*) from communities where id = '${communityId}'`), 1);
  expect(
    "duplikat: samme identifikator med nytt skjema avvises",
    outcome(await operatorClient.rpc("platform_create_community", communityArgs(communityId, { p_slug: `${communityId}-x` }))),
    "id-taken",
  );
  expect(
    "duplikat: samme portaladresse avvises",
    outcome(await operatorClient.rpc("platform_create_community", communityArgs(`${communityId}-y`, { p_slug: communityId }))),
    "slug-taken",
  );
  expect("validering: reservert portaladresse avvises", outcome(await operatorClient.rpc("platform_create_community", communityArgs(`qa-r-${RUN}`, { p_slug: "login" }))), "invalid-slug");
  expect("validering: ugyldig farge avvises", outcome(await operatorClient.rpc("platform_create_community", communityArgs(`qa-c-${RUN}`, { p_accent: "red" }))), "invalid-color");
  expect("validering: ugyldig monogram avvises", outcome(await operatorClient.rpc("platform_create_community", communityArgs(`qa-m-${RUN}`, { p_monogram: "ABCD" }))), "invalid-monogram");

  // 9. A failure part-way leaves nothing behind.
  const partial = `qa-delvis-${RUN}`;
  expect(
    "atomisk: ugyldig administratoradresse etter at raden er satt inn ruller alt tilbake",
    outcome(await operatorClient.rpc("platform_create_community", communityArgs(partial, { p_admin_email: "ikke-en-adresse" }))),
    "invalid-email",
  );
  expect("atomisk: ingen fellesskapsrad", sql(`select count(*) from communities where id = '${partial}'`), 0);
  expect("atomisk: ingen plattformrad", sql(`select count(*) from community_platform_state where community_id = '${partial}'`), 0);
  expect("atomisk: ingen revisjonslinje for det som ikke skjedde", sql(`select count(*) from platform_audit_log where target_id = '${partial}' and result = 'success'`), 0);

  // ── 2, 3, 4, 6: everyone else is refused, by the database ───────────────
  const moderatorClient = await signIn(moderator.email);
  sql(`insert into memberships (user_id, community_id, role, status) values ('${moderator.id}', '${communityId}', 'moderator', 'active')`);
  for (const [label, client] of [
    ["anonym", anon],
    ["vanlig bruker", ordinaryClient],
    ["fellesskapsadministrator", adminClient],
    ["moderator", moderatorClient],
  ] as const) {
    expect(`avvist (${label}): platform_overview`, denied(await client.rpc("platform_overview")), true);
    expect(`avvist (${label}): platform_list_communities`, denied(await client.rpc("platform_list_communities", {})), true);
    expect(`avvist (${label}): platform_get_community`, denied(await client.rpc("platform_get_community", { p_community_id: communityId })), true);
    expect(
      `avvist (${label}): platform_create_community`,
      denied(await client.rpc("platform_create_community", communityArgs(`qa-x-${RUN}`))),
      true,
    );
    expect(`avvist (${label}): platform_suspend_community`, denied(await client.rpc("platform_suspend_community", { p_community_id: communityId, p_reason: "test" })), true);
    expect(`avvist (${label}): platform_appoint_operator`, denied(await client.rpc("platform_appoint_operator", { p_email: stranger.email, p_role: "owner" })), true);
    expect(`avvist (${label}): platform_audit_entries`, denied(await client.rpc("platform_audit_entries", {})), true);
    expect(
      `avvist (${label}): platform_record_failure`,
      denied(await client.rpc("platform_record_failure", { p_action: "community.create", p_target_type: "community", p_target_id: "x", p_reason: "x" })),
      true,
    );
    for (const table of ["platform_operators", "platform_audit_log", "community_platform_state", "platform_onboarding_requests", "platform_onboarding_attempts"] as const) {
      const read = await client.from(table).select("*").limit(1);
      expect(`avvist (${label}): lese ${table} direkte`, denied(read), true);
    }
    expect(
      `avvist (${label}): skrive seg inn i platform_operators direkte`,
      denied(await client.from("platform_operators").insert({ user_id: operator.id, role: "owner" })),
      true,
    );
  }
  expect("avvist: my_platform_access gir ingenting til en vanlig bruker", (await ordinaryClient.rpc("my_platform_access")).data?.length ?? 0, 0);
  expect("avvist: my_platform_access gir ingenting til en fellesskapsadministrator", (await adminClient.rpc("my_platform_access")).data?.length ?? 0, 0);

  // Direct database attempts at the community side.
  const directPromote = await adminClient.from("memberships").update({ role: "admin" }).eq("user_id", moderator.id).eq("community_id", communityId).select();
  expect("direkte: administrator kan ikke skrive memberships direkte", directPromote.error !== null || (directPromote.data?.length ?? 0) === 0, true);
  const directState = await adminClient.from("community_platform_state").update({ status: "active" }).eq("community_id", communityId).select();
  expect("direkte: administrator kan ikke skrive plattformstatus", denied(directState), true);
  expect("direkte: anonym kan ikke sende samarbeidsforespørsel uten serveren", denied(await anon.rpc("submit_onboarding_request", {
    p_organization_name: "X", p_contact_name: "Y", p_contact_email: "a@example.test", p_website: "", p_member_estimate: 1, p_message: "hei hei hei hei", p_client_key: "",
  })), true);

  // ── 5. Operators cannot raise themselves ────────────────────────────────
  expect(
    "eskalering: operatør kan ikke gjøre seg selv til eier",
    outcome(await operatorClient.rpc("platform_set_operator_role", { p_user_id: operator.id, p_role: "owner" })),
    "platform-owner-required",
  );
  expect(
    "eskalering: operatør kan ikke utnevne (seg selv eller andre) som eier",
    outcome(await operatorClient.rpc("platform_appoint_operator", { p_email: operator.email, p_role: "owner" })),
    "platform-owner-required",
  );
  expect("eskalering: operatør kan ikke se operatørlisten", outcome(await operatorClient.rpc("platform_list_operators")), "platform-owner-required");
  expect(
    "eskalering: operatør kan ikke kalle bootstrap",
    denied(await operatorClient.rpc("platform_bootstrap_owner", { p_email: operator.email, p_recovery: true })),
    true,
  );
  expect("eskalering: operatøren er fortsatt operatør", sql(`select role from platform_operators where user_id = '${operator.id}'`), "operator");
  expect(
    "eskalering: eier kan ikke endre sin egen rolle",
    outcome(await ownerClient.rpc("platform_set_operator_role", { p_user_id: owner.id, p_role: "operator" })),
    "self",
  );

  // Fresh MFA for privilege changes: an aal2 token whose MFA moment is old.
  {
    const { data } = await ownerClient.auth.getSession();
    const sessionId = JSON.parse(Buffer.from(data.session!.access_token.split(".")[1], "base64url").toString()).session_id;
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const claims = JSON.stringify({ sub: owner.id, role: "authenticated", aal: "aal2", session_id: sessionId, amr: [{ method: "totp", timestamp: stale }] });
    expect(
      "fersk MFA: en eier med aal2 men MFA for en time siden kan ikke utnevne",
      sqlError(`begin; set local role authenticated; select set_config('request.jwt.claims', '${claims}', true); select public.platform_appoint_operator('${stranger.email}', 'operator'); commit;`),
      "platform-reauth-required",
    );
    expect(
      "fersk MFA: men kan fortsatt gjøre vanlig drift",
      sqlError(`begin; set local role authenticated; select set_config('request.jwt.claims', '${claims}', true); select public.platform_overview(); commit;`),
      "ok",
    );
  }

  // Last owner, enforced in the database for API callers.
  expect(
    "siste eier: alle aktive eiere kan ikke fjernes av en API-kaller, uansett vei",
    sqlError(`begin; select set_config('request.jwt.claims', '${JSON.stringify({ sub: owner.id, role: "authenticated" })}', true); update platform_operators set revoked_at = now() where role = 'owner' and revoked_at is null; commit;`),
    "last-owner",
  );
  expect("siste eier: eierne er urørt", Number(sql(`select count(*) from platform_operators where role = 'owner' and revoked_at is null`)) >= 1, true);

  // ── 10, 11. Administrators: identity comes from Auth ────────────────────
  const second = `qa-andre-${RUN}`;
  created.communities.push(second);
  expect("admin: andre fellesskap uten administrator", outcome(await operatorClient.rpc("platform_create_community", communityArgs(second))), "ok");

  const unconfirmedAssign = await operatorClient.rpc("platform_assign_community_admin", { p_community_id: second, p_email: unconfirmed.email, p_replace: false });
  expect("admin: en ubekreftet adresse gir invitasjon, ikke rolle", unconfirmedAssign.data?.[0]?.outcome, "invited");
  expect("admin: ingen medlemskap for den ubekreftede", sql(`select count(*) from memberships where community_id = '${second}' and user_id = '${unconfirmed.id}'`), 0);

  const invite = await operatorClient.rpc("platform_assign_community_admin", { p_community_id: second, p_email: noPassword.email, p_replace: false });
  expect("admin: en bekreftet konto uten passord gir invitasjon", invite.data?.[0]?.outcome, "invited");
  const token = invite.data?.[0]?.token ?? "";
  expect("admin: invitasjonen har rollen admin", sql(`select role from invitations where community_id = '${second}' and accepted_at is null and revoked_at is null`), "admin");
  expect(
    "admin: forrige administratorinvitasjon er trukket tilbake",
    sql(`select count(*) from invitations where community_id = '${second}' and email = '${unconfirmed.email}' and revoked_at is not null`),
    1,
  );
  expect("admin: invitasjonen vises som administrator på invitasjonssiden", (await anon.rpc("invitation_preview", { p_token: token })).data?.[0]?.invited_role, "admin");

  const strangerClient = await signIn(stranger.email);
  const wrong = await strangerClient.rpc("accept_invitation_token", { p_token: token });
  expect("admin: feil konto kan ikke ta i bruk invitasjonen", wrong.data?.[0]?.reason, "email-mismatch");
  expect("admin: feil konto fikk ingen rolle", sql(`select count(*) from memberships where community_id = '${second}' and user_id = '${stranger.id}'`), 0);
  expect("admin: oppdiktet token gir ingenting", (await strangerClient.rpc("accept_invitation_token", { p_token: "0".repeat(64) })).data?.[0]?.reason, "invalid");
  expect("admin: fellesskapsadministrator i et annet fellesskap kan ikke sende administratorinvitasjonen på nytt", ((await adminClient.rpc("resend_invitation", { p_invitation_id: sql(`select id from invitations where token_hash = public.hash_invitation_token('${token}')`) })).data ?? []).length, 0);

  const noPasswordClient = await signInWithLink(noPassword.email);
  const needsPassword = await noPasswordClient.rpc("accept_invitation_token", { p_token: token });
  expect("admin: riktig konto uten passord må velge passord først", needsPassword.data?.[0]?.reason, "password-required");
  expect("admin: fortsatt ingen rolle før passordet finnes", sql(`select count(*) from memberships where community_id = '${second}' and user_id = '${noPassword.id}'`), 0);
  await admin.auth.admin.updateUserById(noPassword.id, { password: PASSWORD });
  const accepted = await noPasswordClient.rpc("accept_invitation_token", { p_token: token });
  expect("admin: riktig konto med passord blir administrator", accepted.data?.[0]?.reason, "joined");
  expect("admin: rollen er admin", sql(`select role || '/' || status from memberships where community_id = '${second}' and user_id = '${noPassword.id}'`), "admin/active");
  expect("admin: invitasjonen kan ikke brukes to ganger", (await noPasswordClient.rpc("accept_invitation_token", { p_token: token })).data?.[0]?.reason, "already-used");
  expect(
    "admin: ny administratorinvitasjon nektes når fellesskapet har administrator",
    outcome(await operatorClient.rpc("platform_assign_community_admin", { p_community_id: second, p_email: unconfirmed.email, p_replace: false })),
    "admin-exists",
  );
  expect(
    "admin: utnevning av eksisterende konto nektes uten «erstatt»",
    outcome(await operatorClient.rpc("platform_assign_community_admin", { p_community_id: second, p_email: stranger.email, p_replace: false })),
    "admin-exists",
  );
  expect(
    "admin: med «erstatt» blir den nye administrator",
    (await operatorClient.rpc("platform_assign_community_admin", { p_community_id: second, p_email: stranger.email, p_replace: true })).data?.[0]?.outcome,
    "assigned",
  );
  expect("admin: den forrige er vanlig medlem, ikke fjernet", sql(`select role || '/' || status from memberships where community_id = '${second}' and user_id = '${noPassword.id}'`), "member/active");
  expect("admin: fortsatt bare én aktiv administrator", sql(`select count(*) from memberships where community_id = '${second}' and role = 'admin' and status = 'active'`), 1);
  expect("admin: fjern administratorrollen", outcome(await operatorClient.rpc("platform_remove_community_admin", { p_community_id: second })), "ok");
  expect("admin: ingen aktiv administrator etterpå", sql(`select count(*) from memberships where community_id = '${second}' and role = 'admin' and status = 'active'`), 0);

  // An invitation overtaken by an appointment is revoked, not left working.
  const overtaken = await operatorClient.rpc("platform_assign_community_admin", { p_community_id: second, p_email: unconfirmed.email, p_replace: false });
  await operatorClient.rpc("platform_assign_community_admin", { p_community_id: second, p_email: stranger.email, p_replace: false });
  const unconfirmedClient = await signInWithLink(unconfirmed.email);
  await admin.auth.admin.updateUserById(unconfirmed.id, { password: PASSWORD });
  const late = await unconfirmedClient.rpc("accept_invitation_token", { p_token: overtaken.data?.[0]?.token ?? "" });
  expect("admin: en invitasjon som er forbigått av en utnevning virker ikke", late.data?.[0]?.reason, "revoked");

  // ── 14. No content for operators ────────────────────────────────────────
  const secret = `Hemmelig melding ${RUN}`;
  const message = await adminClient.from("messages").insert({ channel_id: channelId, author_id: communityAdmin.id, body: secret }).select("id").single();
  expect("innhold: administratoren skriver en melding", outcome(message), "ok");
  const dm = await adminClient.rpc("start_direct_conversation", { p_community_id: communityId, p_other: moderator.id } as never);
  const conversationId = (dm.data as unknown as string) ?? sql(`select id from direct_conversations where community_id = '${communityId}' limit 1`);
  if (conversationId) {
    await adminClient.from("direct_messages").insert({ conversation_id: conversationId, body: `${secret} DM` } as never);
  }
  for (const [label, client] of [["operatør", operatorClient], ["eier", ownerClient]] as const) {
    expect(`innhold (${label}): ser ingen meldinger`, (await client.from("messages").select("id").eq("channel_id", channelId)).data?.length ?? 0, 0);
    expect(`innhold (${label}): ser ingen kanaler`, (await client.from("channels").select("id").eq("community_id", communityId)).data?.length ?? 0, 0);
    expect(`innhold (${label}): ser ingen direktemeldinger`, (await client.from("direct_messages").select("id")).data?.length ?? 0, 0);
    expect(`innhold (${label}): ser ingen medlemsliste`, (await client.from("memberships").select("user_id").eq("community_id", communityId)).data?.length ?? 0, 0);
    expect(`innhold (${label}): fellesskapsraden er heller ikke synlig`, (await client.from("communities").select("id").eq("id", communityId)).data?.length ?? 0, 0);
    const everything = JSON.stringify([
      (await client.rpc("platform_get_community", { p_community_id: communityId })).data,
      (await client.rpc("platform_list_communities", {})).data,
      (await client.rpc("platform_audit_entries", { p_limit: 200 })).data,
    ]);
    expect(`innhold (${label}): ingen plattformfunksjon returnerer meldingsteksten`, everything.includes(secret), false);
    expect(`innhold (${label}): ingen plattformfunksjon returnerer moderatorens adresse`, everything.includes(moderator.email), false);
  }
  expect("innhold: operatøren er fortsatt ikke medlem", sql(`select count(*) from memberships where user_id in ('${owner.id}','${operator.id}')`), 0);

  // ── 12. Suspension ──────────────────────────────────────────────────────
  const before = sql(`select (select count(*) from messages where channel_id = '${channelId}') || '/' || (select count(*) from memberships where community_id = '${communityId}') || '/' || (select count(*) from direct_messages dm join direct_conversations dc on dc.id = dm.conversation_id where dc.community_id = '${communityId}')`);
  expect("suspensjon: begrunnelse kreves", outcome(await operatorClient.rpc("platform_suspend_community", { p_community_id: communityId, p_reason: "" })), "invalid-reason");
  expect("suspensjon: operatør suspenderer", outcome(await operatorClient.rpc("platform_suspend_community", { p_community_id: communityId, p_reason: `QA ${RUN}` })), "ok");
  expect("suspensjon: to ganger avvises", outcome(await operatorClient.rpc("platform_suspend_community", { p_community_id: communityId, p_reason: "igjen" })), "already-suspended");

  expect("suspensjon: is_member er usann", (await adminClient.rpc("is_member", { cid: communityId })).data, false);
  expect("suspensjon: is_admin er usann", (await adminClient.rpc("is_admin", { cid: communityId })).data, false);
  expect("suspensjon: medlemmet ser at det er suspendert", ((await adminClient.rpc("my_suspended_community_ids")).data ?? []).includes(communityId), true);
  expect("suspensjon: eget medlemskap er synlig", (await adminClient.from("memberships").select("role").eq("community_id", communityId).eq("user_id", communityAdmin.id)).data?.length ?? 0, 1);
  expect("suspensjon: andres medlemskap er skjult", (await adminClient.from("memberships").select("user_id").eq("community_id", communityId).neq("user_id", communityAdmin.id)).data?.length ?? 0, 0);
  expect("suspensjon: meldinger er skjult", (await adminClient.from("messages").select("id").eq("channel_id", channelId)).data?.length ?? 0, 0);
  expect("suspensjon: kanaler er skjult", (await adminClient.from("channels").select("id").eq("community_id", communityId)).data?.length ?? 0, 0);
  expect("suspensjon: direktemeldinger er skjult", (await moderatorClient.from("direct_messages").select("id")).data?.length ?? 0, 0);
  expect("suspensjon: direkte samtaler er skjult", (await moderatorClient.from("direct_conversations").select("id").eq("community_id", communityId)).data?.length ?? 0, 0);
  expect("suspensjon: ny melding avvises", outcome(await adminClient.from("messages").insert({ channel_id: channelId, author_id: communityAdmin.id, body: "x" })) !== "ok", true);
  expect(
    "suspensjon: kanal kan ikke lages via funksjon",
    (await adminClient.rpc("create_community_channel", { p_community_id: communityId, p_name: "ny", p_purpose: "", p_section_id: null as unknown as string, p_creation_key: randomUUID(), p_read_only: false, p_file_sharing: false })).error !== null ||
      Number(sql(`select count(*) from channels where community_id = '${communityId}' and name = 'ny'`)) === 0,
    true,
  );
  const about = await adminClient.rpc("set_community_about", { p_community_id: communityId, p_about: "endret" } as never);
  expect("suspensjon: «Om»-teksten kan ikke endres", about.error !== null || sql(`select about from communities where id = '${communityId}'`) !== "endret", true);
  const dmWrite = conversationId ? await moderatorClient.from("direct_messages").insert({ conversation_id: conversationId, body: "svar" } as never) : { error: { message: "no-conversation" } };
  expect("suspensjon: direktemelding avvises", dmWrite.error !== null, true);
  expect("suspensjon: SQL-kall med medlemmets JWT avvises av triggeren",
    sqlError(`begin; select set_config('request.jwt.claims', '${JSON.stringify({ sub: communityAdmin.id, role: "authenticated" })}', true); insert into posts (community_id, author_id, body, kind) values ('${communityId}', '${communityAdmin.id}', 'x', 'post'); commit;`),
    "community-suspended",
  );
  expect("suspensjon: portalen svarer ikke", (await anon.rpc("portal_by_slug", { p_slug: communityId })).data?.length ?? 0, 0);
  expect("suspensjon: portaladresse fra id svarer ikke", (await anon.rpc("portal_slug_by_id", { p_community_id: communityId })).data ?? "null", "null");
  const requestBefore = sql(`select count(*) from access_requests where community_id = '${communityId}'`);
  expect("suspensjon: tilgangsskjemaet svarer likt", (await anon.rpc("request_community_access", { p_slug: communityId, p_email: `qa-req-${RUN}@example.test`, p_display_name: "QA" })).data, true);
  expect("suspensjon: men lagrer ingenting", sql(`select count(*) from access_requests where community_id = '${communityId}'`), requestBefore);
  expect(
    "suspensjon: ingen administrator utnevnes mens den varer",
    outcome(await operatorClient.rpc("platform_assign_community_admin", { p_community_id: communityId, p_email: stranger.email, p_replace: true })),
    "community-suspended",
  );
  expect("suspensjon: administratoren kan ikke oppheve den", denied(await adminClient.rpc("platform_reactivate_community", { p_community_id: communityId, p_note: "" })), true);
  expect("suspensjon: data er bevart (meldinger/medlemskap/direktemeldinger)", sql(`select (select count(*) from messages where channel_id = '${channelId}') || '/' || (select count(*) from memberships where community_id = '${communityId}') || '/' || (select count(*) from direct_messages dm join direct_conversations dc on dc.id = dm.conversation_id where dc.community_id = '${communityId}')`), before);
  expect("suspensjon: andre fellesskap er upåvirket", (await strangerClient.rpc("is_admin", { cid: second })).data, true);
  expect("suspensjon: tjenesterollen (opprydding) er ikke blokkert", sqlError(`begin; select set_config('request.jwt.claims', '{"role":"service_role"}', true); update messages set body = body where channel_id = '${channelId}'; rollback;`), "ok");

  expect("reaktivering: operatør reaktiverer", outcome(await operatorClient.rpc("platform_reactivate_community", { p_community_id: communityId, p_note: "ok" })), "ok");
  expect("reaktivering: meldingen er synlig igjen", (await adminClient.from("messages").select("body").eq("channel_id", channelId)).data?.some((row) => row.body === secret), true);
  expect("reaktivering: skriving virker igjen", outcome(await adminClient.from("messages").insert({ channel_id: channelId, author_id: communityAdmin.id, body: "tilbake" })), "ok");
  expect("reaktivering: portalen svarer igjen", (await anon.rpc("portal_by_slug", { p_slug: communityId })).data?.length ?? 0, 1);

  // ── Editing ─────────────────────────────────────────────────────────────
  const newSlug = `${communityId}-ny`;
  const update = await operatorClient.rpc("platform_update_community", {
    p_community_id: communityId,
    p_slug: newSlug,
    p_name: `QA nytt navn ${RUN}`,
    p_tagline: "Ny",
    p_public_description: "Ny beskrivelse",
    p_location: "Bergen",
    p_founded_year: 2021,
    p_accent: "#2f5a73",
    p_accent_soft: "#e7eef2",
    p_monogram: "QN",
    p_mark_style: "serif",
    p_access_policy: "invite-only",
    p_default_locale: "en",
    p_member_directory_visibility: "members",
    p_dm_policy: "staff_only",
  });
  expect("endre: operatør endrer fellesskapet", outcome(update), "ok");
  expect("endre: ny portaladresse virker", (await anon.rpc("portal_by_slug", { p_slug: newSlug })).data?.length ?? 0, 1);
  expect("endre: gammel portaladresse virker ikke", (await anon.rpc("portal_by_slug", { p_slug: communityId })).data?.length ?? 0, 0);
  expect(
    "endre: revisjonslinjen har feltene og gammel/ny adresse",
    sql(`select (metadata->'slug'->>'from') || '>' || (metadata->'slug'->>'to') from platform_audit_log where action = 'community.update' and target_id = '${communityId}' order by id desc limit 1`),
    `${communityId}>${newSlug}`,
  );
  expect("endre: «Om»-teksten (organisasjonens egen) er urørt", sql(`select about from communities where id = '${communityId}'`), "");

  // ── Onboarding requests ─────────────────────────────────────────────────
  const submitted = await admin.rpc("submit_onboarding_request", {
    p_organization_name: `QA Forening ${RUN}`,
    p_contact_name: "Kari QA",
    p_contact_email: `qa-request-${RUN}@example.test`,
    p_website: "https://example.test",
    p_member_estimate: 40,
    p_message: "Vi vil gjerne prøve TING.",
    p_client_key: `qa-${RUN}`,
  });
  expect("forespørsel: serveren registrerer en forespørsel", submitted.data, true);
  const requestId = sql(`select id from platform_onboarding_requests where contact_email = 'qa-request-${RUN}@example.test'`);
  created.requests.push(requestId);
  expect("forespørsel: ingen fellesskap er opprettet automatisk", sql(`select community_id is null from platform_onboarding_requests where id = '${requestId}'`), "t");
  for (let i = 0; i < 4; i += 1) {
    await admin.rpc("submit_onboarding_request", {
      p_organization_name: `QA Spam ${i}`, p_contact_name: "S", p_contact_email: `qa-spam-${i}-${RUN}@example.test`, p_website: "", p_member_estimate: 1, p_message: "spam spam spam", p_client_key: `qa-${RUN}`,
    });
  }
  expect("forespørsel: høyst tre per nettverksadresse i timen", sql(`select count(*) from platform_onboarding_requests where contact_email like 'qa-spam-%-${RUN}@example.test'`), 2);
  sql(`delete from platform_onboarding_requests where contact_email like 'qa-spam-%-${RUN}@example.test'`);
  expect("forespørsel: operatør ser den i køen", (await operatorClient.rpc("platform_list_onboarding_requests", { p_status: "pending" })).data?.some((row) => row.id === requestId), true);
  expect("forespørsel: notat lagres", outcome(await operatorClient.rpc("platform_set_onboarding_note", { p_request_id: requestId, p_note: "Ringt opp" })), "ok");
  const fromRequest = `qa-fra-foresporsel-${RUN}`;
  created.communities.push(fromRequest);
  expect(
    "forespørsel: fellesskap opprettes fra forespørselen",
    outcome(await operatorClient.rpc("platform_create_community", communityArgs(fromRequest, { p_onboarding_request_id: requestId }))),
    "ok",
  );
  expect("forespørsel: godkjent og koblet", sql(`select status || '/' || community_id from platform_onboarding_requests where id = '${requestId}'`), `approved/${fromRequest}`);
  expect(
    "forespørsel: samme forespørsel kan ikke brukes to ganger",
    outcome(await operatorClient.rpc("platform_create_community", communityArgs(`${fromRequest}-2`, { p_onboarding_request_id: requestId }))),
    "request-already-provisioned",
  );
  await admin.rpc("submit_onboarding_request", {
    p_organization_name: `QA Avslag ${RUN}`, p_contact_name: "A", p_contact_email: `qa-reject-${RUN}@example.test`, p_website: "", p_member_estimate: 1, p_message: "Vi vil også være med.", p_client_key: `qa-b-${RUN}`,
  });
  const rejectId = sql(`select id from platform_onboarding_requests where contact_email = 'qa-reject-${RUN}@example.test'`);
  created.requests.push(rejectId);
  expect("forespørsel: avslag", outcome(await operatorClient.rpc("platform_review_onboarding_request", { p_request_id: rejectId, p_decision: "rejected", p_note: "Utenfor målgruppen" })), "ok");
  expect("forespørsel: avslått kan ikke behandles på nytt", outcome(await operatorClient.rpc("platform_review_onboarding_request", { p_request_id: rejectId, p_decision: "approved", p_note: "" })), "request-not-pending");
  expect(
    "forespørsel: avslått kan ikke gi fellesskap",
    outcome(await operatorClient.rpc("platform_create_community", communityArgs(`qa-avslag-${RUN}`, { p_onboarding_request_id: rejectId }))),
    "request-rejected",
  );

  // ── 13. Audit ───────────────────────────────────────────────────────────
  const actions = sql(
    `select string_agg(distinct action, ',' order by action) from platform_audit_log where occurred_at > now() - interval '1 hour'
       and (target_id in ('${communityId}','${second}','${fromRequest}','${requestId}','${rejectId}','${operator.id}','${owner.id}'))`,
  ).split(",");
  for (const action of [
    "community.create",
    "community.update",
    "community.suspend",
    "community.reactivate",
    "community.admin.assign",
    "community.admin.invite",
    "community.admin.accept",
    "community.admin.remove",
    "onboarding_request.approve",
    "onboarding_request.reject",
    "onboarding_request.note",
    "platform_operator.appoint",
  ]) {
    expect(`revisjon: ${action} er registrert`, actions.includes(action), true);
  }
  expect("revisjon: aktøren er registrert med adresse og rolle", sql(`select actor_email || '/' || actor_role from platform_audit_log where action = 'community.suspend' and target_id = '${communityId}'`), `${operator.email}/operator`);
  expect("revisjon: ingen token i loggen", sql(`select count(*) from platform_audit_log where metadata::text like '%${token.slice(0, 16)}%'`), 0);
  expect("revisjon: ingen meldingstekst i loggen", sql(`select count(*) from platform_audit_log where metadata::text like '%${secret}%'`), 0);
  expect(
    "revisjon: et mislykket forsøk kan registreres av operatøren",
    outcome(await operatorClient.rpc("platform_record_failure", { p_action: "community.create", p_target_type: "community", p_target_id: communityId, p_reason: "slug-taken" })),
    "ok",
  );
  expect(
    "revisjon: bare kjente handlinger kan registreres",
    outcome(await operatorClient.rpc("platform_record_failure", { p_action: "platform_operator.bootstrap", p_target_type: "platform", p_target_id: "", p_reason: "x" })),
    "invalid-input",
  );
  expect("revisjon: tjenesterollen kan ikke endre en linje", denied(await admin.from("platform_audit_log").update({ result: "failure" }).eq("target_id", communityId).select()), true);
  expect("revisjon: tjenesterollen kan ikke slette en linje", denied(await admin.from("platform_audit_log").delete().eq("target_id", communityId).select()), true);
  expect("revisjon: heller ikke databaseeieren kan endre en linje", sqlError(`update platform_audit_log set result = 'failure' where target_id = '${communityId}'`), "platform_audit_log is append-only");
  expect("revisjon: eller tømme loggen", sqlError(`truncate platform_audit_log`), "platform_audit_log is append-only");
  const operatorView = JSON.stringify((await operatorClient.rpc("platform_audit_entries", { p_limit: 200 })).data);
  expect("revisjon: operatøren ser ikke tilgangsendringer", operatorView.includes("platform_operator."), false);
  expect("revisjon: eieren gjør det", JSON.stringify((await ownerClient.rpc("platform_audit_entries", { p_limit: 200 })).data).includes("platform_operator.appoint"), true);

  // ── Pages over HTTP: 1, 2, 3, 4, 15 ─────────────────────────────────────
  const staleOperator = await signIn(operator.email); // aal1: no second factor this session
  const pageChecks: [string, Client | null, number, string | null][] = [
    ["anonym", null, 404, null],
    ["vanlig bruker", ordinaryClient, 404, null],
    ["fellesskapsadministrator", adminClient, 404, null],
    ["moderator", moderatorClient, 404, null],
    ["operatør uten MFA i økten", staleOperator, 200, "Bekreft at det er deg"],
    ["operatør med MFA", operatorClient, 200, "Fellesskap i alt"],
  ];
  for (const [label, client, status, text] of pageChecks) {
    const response = await page("/platform-admin", client);
    if (!response) {
      skip(`side /platform-admin (${label})`, `${APP_URL} svarer ikke`);
      continue;
    }
    expect(`side (${label}): status`, response.status, status);
    if (text) expect(`side (${label}): innhold`, response.body.includes(text), true);
    if (status === 404) expect(`side (${label}): ingen plattformtekst lekker`, response.body.includes("Plattformadministratorer"), false);
    expect(`side (${label}): ikke indekserbar`, response.headers.get("x-robots-tag")?.includes("noindex") ?? false, true);
  }
  const mfaGate = await page("/platform-admin/fellesskap", staleOperator);
  if (mfaGate) expect("side: uten MFA vises ingen fellesskapsliste", mfaGate.body.includes(communityId), false);
  const detail = await page(`/platform-admin/fellesskap/${communityId}`, operatorClient);
  if (detail) expect("side: operatør ser fellesskapets driftsside", detail.status === 200 && detail.body.includes("Driftsinformasjon"), true);
  const ownerPage = await page("/platform-admin/administratorer", ownerClient);
  if (ownerPage) expect("side: eieren ser plattformadministratorene", ownerPage.body.includes(operator.email), true);
  const operatorOwnerPage = await page("/platform-admin/administratorer", operatorClient);
  if (operatorOwnerPage) expect("side: operatøren ser ikke operatørlisten", operatorOwnerPage.body.includes(owner.email), false);

  // Suspended community, as its member sees it.
  await operatorClient.rpc("platform_suspend_community", { p_community_id: communityId, p_reason: "side" });
  const suspendedPage = await page(`/community/${communityId}`, adminClient);
  if (suspendedPage) {
    expect("side: medlemmet ser at fellesskapet er suspendert", suspendedPage.body.includes("er suspendert"), true);
    expect("side: og ingen meldinger", suspendedPage.body.includes(secret), false);
  } else skip("side: suspendert fellesskap", `${APP_URL} svarer ikke`);
  await operatorClient.rpc("platform_reactivate_community", { p_community_id: communityId, p_note: "" });

  // ── Revocation takes effect on the next request ─────────────────────────
  await verifyMfa(ownerClient, owner.email);
  expect("fjerning: eier fjerner operatøren", outcome(await ownerClient.rpc("platform_revoke_operator", { p_user_id: operator.id })), "ok");
  expect("fjerning: operatørens neste kall avvises (samme token)", outcome(await operatorClient.rpc("platform_overview")), "platform-forbidden");
  const revokedPage = await page("/platform-admin", operatorClient);
  if (revokedPage) expect("fjerning: siden er 404 for den fjernede", revokedPage.status, 404);
  expect("fjerning: registrert", sql(`select count(*) from platform_audit_log where action = 'platform_operator.revoke' and target_id = '${operator.id}'`), 1);
}

async function cleanup() {
  for (const id of created.communities) {
    sqlError(`delete from communities where id like '${id}%'`);
  }
  for (const id of created.requests) {
    if (id) sqlError(`delete from platform_onboarding_requests where id = '${id}'`);
  }
  sqlError(`delete from platform_onboarding_attempts`);
  for (const id of created.users) {
    // Operator rows go with the account (the last-owner rule binds API callers, not the server).
    sqlError(`delete from platform_operators where user_id = '${id}'`);
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
}

main()
  .catch((error) => {
    failures += 1;
    console.error(`\n✗ Avbrutt: ${error instanceof Error ? error.stack ?? error.message : error}`);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n${checks - failures} av ${checks} sjekker bestod${skipped ? `, ${skipped} hoppet over` : ""}.`);
    process.exit(failures > 0 ? 1 : 0);
  });
