/**
 * Checks what the three Data API roles may do in `public`, two ways.
 *
 * 1. In the catalog: the privileges each role holds are compared, exactly,
 *    with the list below. A table added without a grant, a grant wider than
 *    its policy, or a function left callable by everyone fails here before
 *    anyone meets it as a 42501 or, worse, does not meet it at all.
 *
 * 2. Through the API, as real callers: an anonymous visitor, members of
 *    different communities, an account with no membership and the server's
 *    key. Nothing here goes through TING's pages or actions.
 *
 * The expected list repeats supabase/migrations/20261026100000_explicit_api_grants.sql
 * on purpose. A table that needs a grant gets a line in its own migration and
 * a line here; the two disagreeing is the point of the check.
 *
 * Run with `npm run check:grants` against the local stack after
 * `npm run seed`. Reads only, apart from marking one notice with the value it
 * already had.
 */
import { execFileSync } from "node:child_process";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

const FTR = "tryggere-ruspolitikk";
const UTR = "under-the-rug";

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

// ── What each role is meant to hold ───────────────────────────────────────

const COLLABORATION_READ = [
  "collaboration_channels",
  "collaboration_document_versions",
  "collaboration_documents",
  "collaboration_event_organizer_consents",
  "collaboration_event_public_organizers",
  "collaboration_events",
  "collaboration_files",
  "collaboration_manager_participants",
  "collaboration_member_sponsorships",
  "collaboration_members",
  "collaboration_messages",
  "collaboration_participants",
  "collaboration_profiles",
  "collaboration_task_assignees",
  "collaboration_tasks",
  "collaborations",
  "published_collaboration_events",
];

const AUTHENTICATED_READ = [
  "access_requests",
  "account_security",
  "channel_attachment_placements",
  "channel_groups",
  "channel_links",
  "channel_participants",
  "channel_resource_folders",
  "channel_resource_pins",
  "channel_sections",
  "channels",
  "comments",
  "communities",
  "community_emojis",
  "community_local_group_managers",
  "community_local_groups",
  "community_profiles",
  "community_subgroup_managers",
  "community_subgroup_members",
  "community_subgroups",
  "direct_conversation_reads",
  "direct_conversations",
  "direct_messages",
  "event_attendees",
  "events",
  "invitations",
  "message_attachments",
  "messages",
  "notifications",
  "post_reactions",
  "posts",
  "profiles",
  ...COLLABORATION_READ,
];

/** Beyond SELECT. Every table not named here is read-only to a member. */
const AUTHENTICATED_WRITE: Record<string, string[]> = {
  comments: ["INSERT", "UPDATE", "DELETE"],
  events: ["INSERT", "UPDATE", "DELETE"],
  posts: ["INSERT", "UPDATE", "DELETE"],
  community_emojis: ["INSERT", "DELETE"],
  event_attendees: ["INSERT", "DELETE"],
  post_reactions: ["INSERT", "DELETE"],
  messages: ["INSERT"],
};

const AUTHENTICATED_COLUMNS: Record<string, Record<string, string[]>> = {
  memberships: {
    SELECT: ["id", "user_id", "community_id", "role", "status", "joined_at", "title", "invited_by", "local_group_id"],
  },
  community_people: {
    SELECT: ["id", "community_id", "section", "local_group_id", "name", "role", "email", "description", "sort_order", "active", "created_at"],
  },
  direct_messages: { INSERT: ["conversation_id", "body"] },
  notifications: { UPDATE: ["read"] },
};

/** Tables only the server and SECURITY DEFINER functions touch. */
const SERVER_ONLY = ["auth_throttle", "channel_retired_ids", "collaboration_audit_log", "message_attachment_purges"];

const ANON_FUNCTIONS = [
  "invitation_preview(text)",
  "portal_by_slug(text)",
  "portal_events(text)",
  "portal_slug_by_id(text)",
  "published_event_by_slug(text)",
  "published_event_image_is_public(text)",
  "request_community_access(text,text,text)",
];

const SERVICE_ROLE_FUNCTIONS = [
  "begin_password_attempt(text,text)",
  "can_moderate(text)",
  "channel_link_url_valid(text)",
  "complete_message_attachment(uuid)",
  "email_change_cooldown()",
  "ensure_local_group_channel(uuid)",
  "finish_password_attempt(text,text,boolean)",
  "message_attachment_extension(text)",
  "normalize_display_name(text)",
  "normalize_email(text)",
  "password_throttle_key(text)",
  "sweep_abandoned_message_attachments(interval)",
];

/** Written for the server alone; a member's session must not reach them. */
const NEVER_AUTHENTICATED = [
  "begin_password_attempt(text,text)",
  "finish_password_attempt(text,text,boolean)",
  "complete_message_attachment(uuid)",
  "sweep_abandoned_message_attachments(interval)",
  "local_group_slug(text)",
];

// ── 1. The catalog ────────────────────────────────────────────────────────

/** The local stack's database, for what no API reports: who was granted what. */
const sql = (statement: string) =>
  execFileSync(
    "docker",
    ["exec", "-i", process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_vev", "psql", "-U", "postgres", "-d", "postgres", "-AtF", "|", "-c", statement],
    { stdio: ["ignore", "pipe", "pipe"] },
  ).toString().trim();

const rows = (statement: string) => {
  const out = sql(statement);
  return out ? out.split("\n").map((line) => line.split("|")) : [];
};

const API_ROLES = "('anon', 'authenticated', 'service_role')";

function checkCatalog() {
  const tables = rows(
    `select c.relname, c.relkind, c.relrowsecurity from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') order by 1`,
  );
  expect("katalog: ingen visninger i public", tables.filter(([, kind]) => kind === "v" || kind === "m").map(([name]) => name).join(", "), "");
  expect("katalog: radsikkerhet på alle tabeller", tables.filter(([, , rls]) => rls !== "t").map(([name]) => name).join(", "), "");

  const known = new Set([...AUTHENTICATED_READ, ...Object.keys(AUTHENTICATED_COLUMNS), ...SERVER_ONLY]);
  expect(
    "katalog: hver tabell har en linje i denne sjekken",
    tables.map(([name]) => name).filter((name) => !known.has(name)).join(", "),
    "",
  );

  // Table-level privileges, exactly.
  const expected = new Map<string, string>();
  for (const [name] of tables) expected.set(`service_role|${name}`, "DELETE,INSERT,SELECT,UPDATE");
  for (const name of AUTHENTICATED_READ) {
    expected.set(`authenticated|${name}`, ["SELECT", ...(AUTHENTICATED_WRITE[name] ?? [])].sort().join(","));
  }
  const actual = new Map(
    rows(
      `select g.grantee::regrole::text, c.relname, string_agg(g.privilege_type, ',' order by g.privilege_type)
         from pg_class c, aclexplode(c.relacl) g
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
          and g.grantee <> 0 and g.grantee::regrole::text in ${API_ROLES}
        group by 1, 2`,
    ).map(([role, name, privileges]) => [`${role}|${name}`, privileges]),
  );
  for (const key of new Set([...expected.keys(), ...actual.keys()])) {
    expect(`katalog: tabellrettigheter for ${key}`, actual.get(key) ?? "(ingen)", expected.get(key) ?? "(ingen)");
  }

  // Column-level privileges, exactly.
  const expectedColumns = new Map<string, string>();
  for (const [table, commands] of Object.entries(AUTHENTICATED_COLUMNS)) {
    for (const [command, columns] of Object.entries(commands)) {
      expectedColumns.set(`authenticated|${table}|${command}`, [...columns].sort().join(","));
    }
  }
  const actualColumns = new Map(
    rows(
      `select g.grantee::regrole::text, c.relname, g.privilege_type, string_agg(a.attname, ',' order by a.attname)
         from pg_attribute a join pg_class c on c.oid = a.attrelid, aclexplode(a.attacl) g
        where c.relnamespace = 'public'::regnamespace and a.attacl is not null
          and g.grantee <> 0 and g.grantee::regrole::text in ${API_ROLES}
        group by 1, 2, 3`,
    ).map(([role, table, command, columns]) => [`${role}|${table}|${command}`, columns]),
  );
  for (const key of new Set([...expectedColumns.keys(), ...actualColumns.keys()])) {
    expect(`katalog: kolonnerettigheter for ${key}`, actualColumns.get(key) ?? "(ingen)", expectedColumns.get(key) ?? "(ingen)");
  }

  expect(
    "katalog: PUBLIC har ingen tabell eller kolonne",
    sql(
      `select count(*) from (
         select 1 from pg_class c, aclexplode(c.relacl) g where c.relnamespace = 'public'::regnamespace and g.grantee = 0
         union all
         select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid, aclexplode(a.attacl) g
          where c.relnamespace = 'public'::regnamespace and a.attacl is not null and g.grantee = 0) x`,
    ),
    0,
  );

  expect(
    "katalog: sekvenser — bare serverens nøkkel, bare revisjonsloggens",
    sql(
      `select coalesce(string_agg(g.grantee::regrole::text || ':' || c.relname || ':' || g.privilege_type, ',' order by 1), '')
         from pg_class c, aclexplode(c.relacl) g
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
          and (g.grantee = 0 or g.grantee::regrole::text in ${API_ROLES})`,
    ),
    "service_role:collaboration_audit_log_id_seq:USAGE",
  );

  // Functions.
  const callableBy = (role: string) =>
    sql(
      `select coalesce(string_agg(p.oid::regprocedure::text, ';' order by p.oid::regprocedure::text), '')
         from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('${role}', p.oid, 'execute')`,
    );
  expect("katalog: funksjoner anon kan kalle", callableBy("anon"), [...ANON_FUNCTIONS].sort().join(";"));
  expect("katalog: funksjoner serverens nøkkel kan kalle", callableBy("service_role"), [...SERVICE_ROLE_FUNCTIONS].sort().join(";"));
  expect(
    "katalog: ingen funksjon kan kalles av alle (PUBLIC)",
    sql(
      `select coalesce(string_agg(p.oid::regprocedure::text, ';'), '') from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g where g.grantee = 0)`,
    ),
    "",
  );
  expect(
    "katalog: ingen triggerfunksjon kan kalles av en API-rolle",
    sql(
      `select coalesce(string_agg(p.oid::regprocedure::text, ';'), '') from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
               or has_function_privilege('service_role', p.oid, 'execute'))`,
    ),
    "",
  );
  for (const name of NEVER_AUTHENTICATED) {
    expect(`katalog: authenticated kan ikke kalle ${name}`, sql(`select has_function_privilege('authenticated', 'public.${name}', 'execute')`), "f");
  }
  expect(
    "katalog: SECURITY DEFINER uten låst search_path",
    sql(
      `select coalesce(string_agg(p.oid::regprocedure::text, ';'), '') from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    ),
    "",
  );

  // A table created from now on starts with nothing.
  expect(
    "katalog: ingen standardrettigheter for nye objekter i public",
    sql(
      `select count(*) from pg_default_acl d, aclexplode(d.defaclacl) g
        where d.defaclnamespace = 'public'::regnamespace and d.defaclrole = 'postgres'::regrole
          and (g.grantee = 0 or g.grantee::regrole::text in ${API_ROLES})`,
    ),
    0,
  );
}

// ── 2. Through the API ────────────────────────────────────────────────────

type Client = SupabaseClient<Database>;
type Loose = SupabaseClient;

function anonymous(): Client {
  return createClient<Database>(supabaseUrl(), supabaseAnonKey());
}

async function profileId(handle: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw error;
  return data.id;
}

async function signIn(handle: string): Promise<Client> {
  const { data: user, error: userError } = await admin.auth.admin.getUserById(await profileId(handle));
  if (userError) throw userError;
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user!.email! });
  if (error || !data.properties) throw new Error(`kunne ikke lage lenke for ${handle}: ${error?.message}`);
  const client = anonymous();
  const { error: verifyError } = await client.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
  if (verifyError) throw verifyError;
  return client;
}

const DENIED = "42501";
const code = (result: { error: { code?: string } | null }) => result.error?.code ?? "ok";

async function checkAnonymous() {
  const anon = anonymous() as unknown as Loose;
  for (const table of [...AUTHENTICATED_READ, ...Object.keys(AUTHENTICATED_COLUMNS), ...SERVER_ONLY]) {
    expect(`anon: kan ikke lese ${table}`, code(await anon.from(table).select("*").limit(1)), DENIED);
  }
  // Not even the columns members read by name.
  expect("anon: kan ikke lese medlemskap kolonnevis", code(await anon.from("memberships").select("id, community_id").limit(1)), DENIED);
  expect("anon: kan ikke skrive et innlegg", code(await anon.from("posts").insert({ community_id: FTR, title: "x", body: "x" })), DENIED);
  expect("anon: kan ikke slette meldinger", code(await anon.from("messages").delete().eq("body", "finnes-ikke")), DENIED);

  const portal = await anon.rpc("portal_by_slug", { p_slug: FTR });
  expect("anon: portalen svarer", code(portal), "ok");
  expect("anon: portalen gir ett fellesskap", (portal.data as unknown[] | null)?.length, 1);
  expect("anon: kan ikke kalle is_admin", code(await anon.rpc("is_admin", { cid: FTR })), DENIED);
  expect("anon: kan ikke godkjenne en forespørsel", code(await anon.rpc("approve_access_request", { p_request_id: crypto.randomUUID() })), DENIED);
  expect(
    "anon: kan ikke telle passordforsøk",
    code(await anon.rpc("begin_password_attempt", { p_email: "x@example.com", p_ip: "203.0.113.1" })),
    DENIED,
  );
}

async function checkMembers() {
  const jonas = await signIn("jonas"); // member of Under The Rug only
  const linn = await signIn("linn"); // member of Tryggere Ruspolitikk only
  const sofie = await signIn("sofie"); // no membership anywhere
  const loose = (client: Client) => client as unknown as Loose;

  // Each member reads their own community…
  const own = await jonas.from("communities").select("id");
  expect("jonas: leser fellesskapene sine", own.data?.map((row) => row.id).sort().join(","), UTR);
  expect("jonas: ser kanaler i sitt fellesskap", ((await jonas.from("channels").select("id").eq("community_id", UTR)).data?.length ?? 0) > 0, true);
  expect("linn: leser fellesskapene sine", (await linn.from("communities").select("id")).data?.map((row) => row.id).join(","), FTR);

  // …and nothing of another, table by table.
  for (const table of ["channels", "channel_sections", "posts", "events", "community_local_groups", "community_profiles", "community_subgroups", "access_requests", "invitations"]) {
    const result = await loose(jonas).from(table).select("*").eq("community_id", FTR);
    expect(`jonas: ${table} i et annet fellesskap`, `${code(result)}:${result.data?.length ?? "-"}`, "ok:0");
  }
  const otherMembers = await jonas.from("memberships").select("id").eq("community_id", FTR);
  expect("jonas: medlemslisten i et annet fellesskap", `${code(otherMembers)}:${otherMembers.data?.length}`, "ok:0");
  const { data: ftrChannels } = await admin.from("channels").select("id").eq("community_id", FTR);
  const otherMessages = await jonas.from("messages").select("id").in("channel_id", (ftrChannels ?? []).map((row) => row.id));
  expect("jonas: meldinger i et annet fellesskap", `${code(otherMessages)}:${otherMessages.data?.length}`, "ok:0");
  const { data: linnProfile } = await jonas.from("profiles").select("id").eq("handle", "linn");
  expect("jonas: profilen til en han ikke deler fellesskap med", linnProfile?.length, 0);

  // An account with no membership reads no community at all.
  expect("sofie: ingen fellesskap", (await sofie.from("communities").select("id")).data?.length, 0);
  expect("sofie: ingen kanaler", (await sofie.from("channels").select("id")).data?.length, 0);
  expect("sofie: ingen medlemskap", (await sofie.from("memberships").select("id")).data?.length, 0);

  // Columns kept back from members.
  expect("jonas: accepts_member_dms er ikke lesbar", code(await loose(jonas).from("memberships").select("accepts_member_dms").limit(1)), DENIED);
  expect("jonas: onboarding_dismissed_at er ikke lesbar", code(await loose(jonas).from("memberships").select("onboarding_dismissed_at").limit(1)), DENIED);
  expect("jonas: community_people.user_id er ikke lesbar", code(await loose(jonas).from("community_people").select("user_id").limit(1)), DENIED);
  expect("jonas: medlemskap med * er ikke lesbart", code(await loose(jonas).from("memberships").select("*").limit(1)), DENIED);

  // Writes no policy allows are refused on privilege, before any row is looked at.
  const jonasId = await profileId("jonas");
  const refused: [string, () => PromiseLike<{ error: { code?: string } | null }>][] = [
    ["melde seg inn selv", () => loose(jonas).from("memberships").insert({ user_id: jonasId, community_id: FTR, status: "active" })],
    ["gjøre seg til administrator", () => loose(jonas).from("memberships").update({ role: "admin" }).eq("user_id", jonasId)],
    ["melde seg ut ved sletting", () => loose(jonas).from("memberships").delete().eq("user_id", jonasId)],
    ["endre fellesskapet", () => loose(jonas).from("communities").update({ name: "x" }).eq("id", UTR)],
    ["opprette et fellesskap", () => loose(jonas).from("communities").insert({ id: "x", slug: "x", name: "x" })],
    ["opprette en kanal", () => loose(jonas).from("channels").insert({ id: "x", community_id: UTR, name: "x" })],
    ["opprette en kanalseksjon direkte", () => loose(jonas).from("channel_sections").insert({ community_id: UTR, name: "x" })],
    ["endre en kanalseksjon direkte", () => loose(jonas).from("channel_sections").update({ name: "x" }).eq("community_id", UTR)],
    ["redigere en melding", () => loose(jonas).from("messages").update({ body: "x" }).eq("author_id", jonasId)],
    ["slette en melding", () => loose(jonas).from("messages").delete().eq("author_id", jonasId)],
    ["endre profilen direkte", () => loose(jonas).from("profiles").update({ name: "x" }).eq("id", jonasId)],
    ["lage et varsel", () => loose(jonas).from("notifications").insert({ user_id: jonasId, kind: "announcement", title: "x" })],
    ["slette et varsel", () => loose(jonas).from("notifications").delete().eq("user_id", jonasId)],
    ["endre teksten i et varsel", () => loose(jonas).from("notifications").update({ title: "x" }).eq("user_id", jonasId)],
    ["invitere noen direkte", () => loose(jonas).from("invitations").insert({ community_id: UTR, email: "x@example.com", token_hash: "x" })],
    ["godkjenne en forespørsel direkte", () => loose(jonas).from("access_requests").update({ status: "approved" }).eq("community_id", UTR)],
    ["sette eget passordmerke", () => loose(jonas).from("account_security").update({ password_set_at: new Date().toISOString() }).eq("user_id", jonasId)],
    ["lese forsøkstellingen", () => loose(jonas).from("auth_throttle").select("*").limit(1)],
    ["lese slettekøen", () => loose(jonas).from("message_attachment_purges").select("*").limit(1)],
    ["lese revisjonsloggen", () => loose(jonas).from("collaboration_audit_log").select("*").limit(1)],
    ["føre et vedlegg selv", () => loose(jonas).from("message_attachments").delete().eq("uploader_id", jonasId)],
    ["sende en direktemelding i en annens navn", () => loose(jonas).from("direct_messages").insert({ conversation_id: crypto.randomUUID(), body: "x", author_id: jonasId })],
    ["telle passordforsøk", () => loose(jonas).rpc("begin_password_attempt", { p_email: "x@example.com", p_ip: "203.0.113.1" })],
    ["rydde vedlegg", () => loose(jonas).rpc("sweep_abandoned_message_attachments", { p_older_than: "1 hour" })],
  ];
  for (const [label, attempt] of refused) {
    expect(`jonas: kan ikke ${label}`, code(await attempt()), DENIED);
  }

  // A granted command still answers to its policy: an innlegg in a community
  // he is not in is refused by row level security, not by a missing grant.
  const foreignPost = await loose(jonas).from("posts").insert({ community_id: FTR, title: "x", body: "x" });
  expect("jonas: innlegg i et annet fellesskap avvises", code(foreignPost), DENIED);
  expect("jonas: … av radsikkerheten", /row-level security/.test(foreignPost.error?.message ?? ""), true);

  // The one column of a notice a member may change. Written back unchanged.
  const { data: notice } = await linn.from("notifications").select("id, read").limit(1).maybeSingle();
  if (notice) {
    expect("linn: kan merke eget varsel som lest", code(await linn.from("notifications").update({ read: notice.read }).eq("id", notice.id)), "ok");
  }
}

async function checkServer() {
  const server = admin as unknown as Loose;
  for (const table of [...AUTHENTICATED_READ, ...Object.keys(AUTHENTICATED_COLUMNS), ...SERVER_ONLY]) {
    expect(`server: leser ${table}`, code(await server.from(table).select("*").limit(1)), "ok");
  }

  // What the running app and `npm run attachments:sweep` do with the key.
  const never = "00000000-0000-0000-0000-000000000000";
  expect("server: leser slettekøen", code(await admin.from("message_attachment_purges").select("storage_path").limit(1)), "ok");
  expect("server: tømmer slettekøen", code(await admin.from("message_attachment_purges").delete().eq("storage_path", "finnes/ikke")), "ok");
  expect("server: fjerner et usendt vedlegg", code(await admin.from("message_attachments").delete().eq("id", never).neq("status", "sent")), "ok");
  expect("server: rydder forlatte opplastinger", code(await admin.rpc("sweep_abandoned_message_attachments", { p_older_than: "100 years" })), "ok");
  expect("server: fullfører et vedlegg som ikke finnes", code(await admin.rpc("complete_message_attachment", { p_attachment_id: never })), "ok");
  expect("server: finner tellenøkkelen", code(await admin.rpc("password_throttle_key", { p_email: "x@example.com" })), "ok");

  // And nothing written for members: the key is not an administrator of any
  // community, and is not offered the functions that assume one.
  expect("server: kan ikke godkjenne en forespørsel", code(await admin.rpc("approve_access_request", { p_request_id: never })), DENIED);
  expect("server: kan ikke kalle is_admin", code(await admin.rpc("is_admin", { cid: FTR })), DENIED);

  // A SECURITY INVOKER trigger calls can_moderate() as whoever writes the row.
  // An update that matches nothing still has to get past that check.
  expect("server: oppdaterer innlegg forbi vakttriggeren", code(await admin.from("posts").update({ pinned: false }).eq("id", never)), "ok");
}

async function main() {
  checkCatalog();
  await checkAnonymous();
  await checkMembers();
  await checkServer();

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} rettighetskontroller feilet.\n`);
    return;
  }
  console.log(`✓ ${checks} rettighetskontroller passerte`);
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(() => {
    if (failures > 0) process.exit(1);
  });
