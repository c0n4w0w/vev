/**
 * Checks the collaboration workspace (Step 2): channels, threads, tasks,
 * documents, files, event planning and public event publishing.
 *
 * Run with `npm run check:collaboration-workspace` against the local stack
 * after `npm run seed`, with the app running (`npm run dev`, or
 * CHECK_BASE_URL) — the upload route is exercised over HTTP, as
 * check:demo-entry does. Every permission check runs as a signed-in fixture
 * account through the anon key and calls exactly the RPCs and reads the
 * server actions and pages use, so a pass means the DATABASE refuses — not a
 * hidden button. The storage checks go through the Storage API with the same
 * sessions, so the bucket policies are what is being tested.
 *
 * The service role is used to read state back, to stage adversarial rows no
 * client could write (a reply to a reply, an assignee who never joined), to
 * change a membership the way an administrator's own tools would, and to put
 * everything back. Catalogue checks run through psql in the local database
 * container.
 *
 * The scenario is the real one: Tryggere Ungdom and Tryggere Ruspolitikk,
 * which takes part through its Oslo lokallag, organise a seminar together.
 * Under The Rug stands in as an unrelated organisation with its own separate
 * collaboration; no third organisation is invented. Everything made here is
 * deleted afterwards.
 *
 * Numbers follow the checklist the feature was specified with (1–72); "S"
 * marks additional adversarial or structural checks.
 */
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";
import { detectCollaborationFileType } from "@/lib/collaboration-file-type";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

const FTR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const UTR = "under-the-rug";

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

type Client = SupabaseClient<Database>;
type Loose = SupabaseClient;

const WORKSPACE_TABLES = [
  "collaboration_channels",
  "collaboration_messages",
  "collaboration_documents",
  "collaboration_document_versions",
  "collaboration_events",
  "collaboration_event_public_organizers",
  "collaboration_event_organizer_consents",
  "collaboration_tasks",
  "collaboration_task_assignees",
  "collaboration_files",
  "published_collaboration_events",
] as const;

// ── Catalogue access (local stack only) ─────────────────────────────────

function sql(query: string): string {
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync("supabase/config.toml", "utf8"))?.[1];
  if (!projectId) throw new Error("fant ikke project_id i supabase/config.toml");
  return execFileSync(
    "docker",
    ["exec", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-tAX", "-c", query],
    { encoding: "utf8" },
  ).trim();
}

// ── Clients ─────────────────────────────────────────────────────────────

async function profileId(handle: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw new Error(`ukjent handle ${handle}: ${error.message}`);
  return data.id;
}

async function signIn(handle: string): Promise<Client> {
  const { data: user, error } = await admin.auth.admin.getUserById(await profileId(handle));
  if (error) throw error;
  const { data, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.user!.email!,
  });
  if (linkError || !data.properties) throw new Error(`kunne ikke lage lenke for ${handle}: ${linkError?.message}`);
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw verifyError;
  return client;
}

/**
 * A signed-in session as the running app sees it: the auth cookies
 * `@supabase/ssr` itself writes when the one-time token is redeemed, in the
 * same format and chunking the browser would carry. Used to drive the upload
 * route over HTTP exactly as the file form does.
 */
async function sessionCookie(handle: string): Promise<string> {
  const { data: user } = await admin.auth.admin.getUserById(await profileId(handle));
  const { data } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user!.email! });
  const jar = new Map<string, string>();
  const client = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { error } = await client.auth.verifyOtp({ type: "magiclink", token_hash: data.properties!.hashed_token });
  if (error) throw error;
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";

/** POST one file to the collaboration upload route, as the file form does. */
async function uploadViaRoute(
  slug: string,
  file: { bytes: Uint8Array; name: string; type: string },
  options: { cookie?: string; origin?: string; displayName?: string; extra?: Record<string, string> } = {},
) {
  const form = new FormData();
  form.set("file", new File([file.bytes as BlobPart], file.name, { type: file.type }));
  if (options.displayName) form.set("displayName", options.displayName);
  for (const [name, value] of Object.entries(options.extra ?? {})) form.set(name, value);
  const response = await fetch(`${BASE}/collaboration/${slug}/files/upload`, {
    method: "POST",
    body: form,
    redirect: "manual",
    headers: {
      origin: options.origin ?? new URL(BASE).origin,
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
  });
  const body = (await response.json().catch(() => null)) as { ok?: boolean; id?: string } | null;
  return { status: response.status, id: body?.ok ? (body.id ?? null) : null };
}

// ── Calls: the exact RPCs the server actions make ───────────────────────

async function rpc(client: Client, name: string, args: Record<string, unknown>) {
  return (client as unknown as Loose).rpc(name, args);
}

async function rpcId(client: Client, name: string, args: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await rpc(client, name, args);
  return !error && typeof data === "string" ? data : null;
}

async function rpcOk(client: Client, name: string, args: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await rpc(client, name, args);
  return !error && data === true;
}

/** Row count of a client read; an error is reported as such, never as zero. */
function seen(result: { data: unknown[] | null; error: { message: string } | null }): number | string {
  return result.error ? `feil: ${result.error.message}` : (result.data ?? []).length;
}

/** Zero rows or a refusal — both mean "cannot read". */
function refusedOrEmpty(result: { data: unknown[] | null; error: unknown }): boolean {
  return result.error !== null || (result.data ?? []).length === 0;
}

async function count(client: Client, table: string, filter: Record<string, string>) {
  let query = (client as unknown as Loose).from(table).select("*");
  for (const [column, value] of Object.entries(filter)) query = query.eq(column, value);
  return seen(await query);
}

const nullable = <T>(value: T | null) => value as T;

async function createCollaboration(client: Client, communityId: string, name: string) {
  const { data, error } = await client.rpc("create_collaboration", {
    p_source_community_id: communityId,
    p_source_local_group_id: nullable<string>(null),
    p_name: name,
    p_slug: nullable<string>(null),
    p_description: "Privat arbeidsrom for arrangørene.",
  });
  if (error || !data) throw new Error(`kunne ikke opprette samarbeid: ${error?.message}`);
  created.add(data);
  return data;
}

async function sponsorAndJoin(representative: Client, person: Client, collaborationId: string, participantId: string, userId: string) {
  const sponsorship = await rpcId(representative, "invite_collaboration_member", {
    p_collaboration_id: collaborationId,
    p_participant_id: participantId,
    p_target_user_id: userId,
  });
  if (!sponsorship) throw new Error(`sponsing feilet for ${userId}`);
  const joined = await rpcOk(person, "accept_collaboration_sponsorship_and_join", { p_sponsorship_id: sponsorship });
  if (!joined) throw new Error(`kunne ikke bli med: ${userId}`);
  return sponsorship;
}

async function persona(client: Client, collaborationId: string, name: string) {
  const ok = await rpcOk(client, "upsert_my_collaboration_profile", {
    p_collaboration_id: collaborationId,
    p_display_name: name,
    p_bio: "",
  });
  if (!ok) throw new Error(`kunne ikke lage samarbeidsprofil ${name}`);
}

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
);

async function upload(client: Client, bucket: string, path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
  if (!error) uploaded.push({ bucket, path });
  return error === null;
}

async function uploadAndRegister(
  client: Client,
  collaborationId: string,
  name: string,
  bytes: Uint8Array,
  mime: string,
  ext: string,
) {
  const id = randomUUID();
  const path = `${collaborationId}/${id}.${ext}`;
  if (!(await upload(client, "collaboration-files", path, bytes, mime))) return { id: null, path };
  const registered = await rpcId(client, "register_collaboration_file", {
    p_collaboration_id: collaborationId,
    p_file_id: id,
    p_display_name: name,
    p_mime_type: mime,
  });
  return { id: registered, path };
}

async function canDownload(client: Client, bucket: string, path: string) {
  const { data, error } = await client.storage.from(bucket).download(path);
  return !error && !!data;
}

async function publicEvent(client: Client, slug: string) {
  const { data, error } = await rpc(client, "published_event_by_slug", { p_slug: slug });
  if (error) return { error: error.message } as Record<string, unknown>;
  return ((Array.isArray(data) ? data[0] : data) ?? {}) as Record<string, unknown>;
}

// ── Bookkeeping, restored in `finally` ──────────────────────────────────

const created = new Set<string>();
const uploaded: { bucket: string; path: string }[] = [];
const touchedMemberships = new Map<string, Database["public"]["Tables"]["memberships"]["Row"]>();
// Moving a membership out of its lokallag deletes that person's lokallagsleder
// grant there (20261010100000), and moving back deliberately does not restore
// it — so the grants are remembered with the membership and put back here.
const touchedGrants: Database["public"]["Tables"]["community_local_group_managers"]["Row"][] = [];

async function rememberMembership(userId: string, communityId: string) {
  const { data } = await admin.from("memberships").select("*").eq("user_id", userId).eq("community_id", communityId).single();
  if (data && !touchedMemberships.has(data.id)) {
    touchedMemberships.set(data.id, data);
    const { data: grants } = await admin
      .from("community_local_group_managers")
      .select("*")
      .eq("user_id", userId)
      .eq("community_id", communityId);
    touchedGrants.push(...(grants ?? []));
  }
}

async function restore() {
  for (const row of [...touchedMemberships.values()].reverse()) {
    await admin
      .from("memberships")
      .update({ status: row.status, role: row.role, local_group_id: row.local_group_id, joined_at: row.joined_at })
      .eq("id", row.id);
  }
  if (touchedGrants.length > 0) {
    await admin
      .from("community_local_group_managers")
      .upsert(touchedGrants, { onConflict: "local_group_id,user_id", ignoreDuplicates: true });
  }
  const byBucket = new Map<string, string[]>();
  for (const { bucket, path } of uploaded) byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), path]);
  for (const [bucket, paths] of byBucket) await admin.storage.from(bucket).remove(paths);
  if (created.size > 0) await admin.from("collaborations").delete().in("id", [...created]);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Checks ──────────────────────────────────────────────────────────────

async function main() {
  const ids = {
    emma: await profileId("emmamortensen"), // TU admin
    hanne: await profileId("hanne"), // TU moderator — never selected
    adrian: await profileId("adrian"), // TU member
    petter: await profileId("petter"), // TU member; FTR member (Trøndelag)
    ingrid: await profileId("ingrid"), // FTR + TU moderator, UTR member
    miaminge: await profileId("miaminge"), // FTR admin, not in Oslo
    amina: await profileId("amina"), // FTR moderator in Oslo — never selected
    kristoffer: await profileId("kristoffer"), // FTR member, Oslo
    octavio: await profileId("octavio"), // UTR admin
    sofie: await profileId("sofie"), // no relationship to anything
  };
  const groups = (await admin.from("community_local_groups").select("id, name")).data ?? [];
  const OSLO = groups.find((g) => g.name === "FTR Oslo")!.id;

  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const emma = await signIn("emmamortensen");
  const hanne = await signIn("hanne");
  const adrian = await signIn("adrian");
  const petter = await signIn("petter");
  const ingrid = await signIn("ingrid");
  const miaminge = await signIn("miaminge");
  const amina = await signIn("amina");
  const kristoffer = await signIn("kristoffer");
  const octavio = await signIn("octavio");
  const sofie = await signIn("sofie");

  // ══ SETUP — through the ordinary Step 1 functions ═══════════════════

  const C = await createCollaboration(emma, TU, "Seminar: Strategier, markedsføring og differensiering");
  const P_TU = (await admin.from("collaboration_participants").select("id").eq("collaboration_id", C).single()).data!.id;
  const P_OSLO = await rpcId(emma, "invite_collaboration_participant", { p_collaboration_id: C, p_community_id: FTR });
  if (!P_OSLO) throw new Error("kunne ikke invitere FTR");
  if (!(await rpcOk(miaminge, "accept_collaboration_participant_invite", { p_participant_id: P_OSLO, p_local_group_id: OSLO }))) {
    throw new Error("FTR Oslo kunne ikke akseptere");
  }
  await sponsorAndJoin(emma, adrian, C, P_TU, ids.adrian);
  const S_kristoffer = await sponsorAndJoin(miaminge, kristoffer, C, P_OSLO, ids.kristoffer);
  await sponsorAndJoin(emma, ingrid, C, P_TU, ids.ingrid);

  // A second, unrelated collaboration. Ingrid is in both — the case where
  // cross-collaboration confusion would actually be possible.
  const C2 = await createCollaboration(octavio, UTR, "UTR-intern planlegging");
  const P_UTR = (await admin.from("collaboration_participants").select("id").eq("collaboration_id", C2).single()).data!.id;
  await sponsorAndJoin(octavio, ingrid, C2, P_UTR, ids.ingrid);

  expect("fixtur: Emma har tilgang og er forvalter", `${await rpcOk(emma, "has_collaboration_access", { p_collaboration_id: C })}|${await rpcOk(emma, "is_collaboration_manager", { p_collaboration_id: C })}`, "true|true");
  expect("fixtur: Mia er forvalter uten tilgang (bare representant)", `${await rpcOk(miaminge, "has_collaboration_access", { p_collaboration_id: C })}|${await rpcOk(miaminge, "is_collaboration_manager", { p_collaboration_id: C })}`, "false|true");
  expect("fixtur: Ingrid har tilgang til begge samarbeidene", `${await rpcOk(ingrid, "has_collaboration_access", { p_collaboration_id: C })}|${await rpcOk(ingrid, "has_collaboration_access", { p_collaboration_id: C2 })}`, "true|true");
  expect("fixtur: Emma har ikke tilgang til C2", await rpcOk(emma, "has_collaboration_access", { p_collaboration_id: C2 }), false);

  // Identity: posting requires a collaboration profile. Adrian has joined but
  // has none yet.
  const general = (await admin.from("collaboration_channels").select("id, name, is_default, status").eq("collaboration_id", C)).data!;
  expect("S: nøyaktig én kanal opprettes automatisk", general.length, 1);
  expect("S: den automatiske kanalen er #general og standard", `${general[0].name}|${general[0].is_default}|${general[0].status}`, "general|true|active");
  const GENERAL = general[0].id;
  expect("14: uten samarbeidsprofil kan man ikke skrive (ingen reserveidentitet)", await rpcId(adrian, "post_collaboration_message", { p_channel_id: GENERAL, p_parent_message_id: null, p_body: "Hei" }), null);

  await persona(emma, C, "Emma (TU)");
  await persona(adrian, C, "Adrian – frivillig");
  await persona(kristoffer, C, "Kristoffer i Oslo");
  await persona(ingrid, C, "Ingrid Samarbeid");
  await persona(octavio, C2, "Octavio");
  await persona(ingrid, C2, "Ingrid UTR");

  // ══ CHANNELS (1–7) ═══════════════════════════════════════════════════

  expect("1: effektivt medlem ser kanalene", await count(adrian, "collaboration_channels", { collaboration_id: C }), 1);
  const PROGRAM = await rpcId(emma, "create_collaboration_channel", { p_collaboration_id: C, p_name: "# Program", p_description: "Paneler og talere" });
  expect("2: forvalter med tilgang kan opprette kanal", typeof PROGRAM, "string");
  const programRow = (await admin.from("collaboration_channels").select("name").eq("id", PROGRAM!).single()).data;
  expect("2: kanalnavnet normaliseres", programRow?.name, "program");
  for (const name of ["kommunikasjon", "frivillige", "Praktisk"]) {
    expect(`2: forvalter oppretter #${name.toLowerCase()}`, typeof (await rpcId(emma, "create_collaboration_channel", { p_collaboration_id: C, p_name: name, p_description: null })), "string");
  }
  const PRAKTISK = (await admin.from("collaboration_channels").select("id").eq("collaboration_id", C).eq("name", "praktisk").single()).data!.id;
  expect("2: samme navn to ganger avvises", await rpcId(emma, "create_collaboration_channel", { p_collaboration_id: C, p_name: "PROGRAM", p_description: null }), null);
  expect("2: tomt navn avvises", await rpcId(emma, "create_collaboration_channel", { p_collaboration_id: C, p_name: " ### ", p_description: null }), null);
  expect("2: vanlig medlem kan ikke opprette kanal", await rpcId(adrian, "create_collaboration_channel", { p_collaboration_id: C, p_name: "adrian", p_description: null }), null);
  expect("2: vanlig medlem kan ikke endre kanal", await rpcOk(adrian, "update_collaboration_channel", { p_channel_id: PROGRAM, p_name: "kapret", p_description: null }), false);
  expect("2: medlem ser alle fem kanalene", await count(adrian, "collaboration_channels", { collaboration_id: C }), 5);

  expect("3: bare-representant ser ingen kanaler", await count(miaminge, "collaboration_channels", { collaboration_id: C }), 0);
  expect("3: bare-representant (forvalter) kan ikke opprette kanal", await rpcId(miaminge, "create_collaboration_channel", { p_collaboration_id: C, p_name: "mia", p_description: null }), null);
  expect("3: bare-representant kan ikke arkivere kanal", await rpcOk(miaminge, "set_collaboration_channel_status", { p_channel_id: PROGRAM, p_status: "archived" }), false);
  expect("3: bare-representant kan ikke gi kanalen nytt navn", await rpcOk(miaminge, "update_collaboration_channel", { p_channel_id: PROGRAM, p_name: "mia", p_description: null }), false);
  expect("4: uvalgt medlem i TU ser ingen kanaler", await count(hanne, "collaboration_channels", { collaboration_id: C }), 0);
  expect("4: uvalgt medlem i FTR Oslo ser ingen kanaler", await count(amina, "collaboration_channels", { collaboration_id: C }), 0);
  expect("5: anonym ser ingen kanaler", refusedOrEmpty(await anon.from("collaboration_channels").select("id")), true);
  expect("6: C2-bruker ser ingen C-kanaler", await count(octavio, "collaboration_channels", { collaboration_id: C }), 0);

  expect("7: standardkanalen kan ikke arkiveres", await rpcOk(emma, "set_collaboration_channel_status", { p_channel_id: GENERAL, p_status: "archived" }), false);
  expect("7: forvalter arkiverer #praktisk", await rpcOk(emma, "set_collaboration_channel_status", { p_channel_id: PRAKTISK, p_status: "archived" }), true);
  expect("7: arkivert kanal tar ikke nye meldinger", await rpcId(adrian, "post_collaboration_message", { p_channel_id: PRAKTISK, p_parent_message_id: null, p_body: "Hei?" }), null);
  expect("7: arkivert kanal er fortsatt lesbar for teamet", await count(adrian, "collaboration_channels", { id: PRAKTISK }), 1);
  expect("7: vanlig medlem kan ikke gjenåpne", await rpcOk(adrian, "set_collaboration_channel_status", { p_channel_id: PRAKTISK, p_status: "active" }), false);
  expect("7: forvalter gjenåpner", await rpcOk(emma, "set_collaboration_channel_status", { p_channel_id: PRAKTISK, p_status: "active" }), true);
  expect("7: gjenåpnet kanal tar meldinger igjen", typeof (await rpcId(adrian, "post_collaboration_message", { p_channel_id: PRAKTISK, p_parent_message_id: null, p_body: "Hvem har nøkkel til lokalet?" })), "string");
  expect("S: kanaler slettes aldri av klienter", (await (emma as unknown as Loose).from("collaboration_channels").delete().eq("id", PRAKTISK).select("id")).data?.length ?? 0, 0);

  // ══ MESSAGES (8–14) ══════════════════════════════════════════════════

  const M_q = await rpcId(emma, "post_collaboration_message", { p_channel_id: PROGRAM, p_parent_message_id: null, p_body: "Hvem inviterer vi til panel 2?" });
  expect("8: effektivt medlem kan poste", typeof M_q, "string");
  const M_k = await rpcId(kristoffer, "post_collaboration_message", { p_channel_id: GENERAL, p_parent_message_id: null, p_body: "Hei fra FTR Oslo! Jeg tar grafikken." });
  expect("8: medlem fra den andre organisasjonen kan poste", typeof M_k, "string");
  const kRow = (await admin.from("collaboration_messages").select("author_id, collaboration_id, channel_id").eq("id", M_k!).single()).data!;
  expect("9: forfatter er den innloggede", kRow.author_id, ids.kristoffer);
  expect("9: samarbeidet utledes fra kanalen", kRow.collaboration_id, C);
  const forged = await rpc(adrian, "post_collaboration_message", { p_channel_id: GENERAL, p_parent_message_id: null, p_body: "Forfalsket", p_author_id: ids.emma });
  expect("9: det finnes ingen forfatter-parameter å forfalske", forged.error !== null, true);
  const directInsert = await (adrian as unknown as Loose).from("collaboration_messages").insert({ collaboration_id: C, channel_id: GENERAL, author_id: ids.emma, body: "Direkte" });
  expect("9: direkte INSERT i collaboration_messages avvises", directInsert.error !== null, true);
  const directUpdate = await (adrian as unknown as Loose).from("collaboration_messages").update({ body: "Kapret" }).eq("id", M_k!).select("id");
  expect("9: direkte UPDATE av andres melding avvises", refusedOrEmpty(directUpdate), true);
  expect("S: blank melding avvises", await rpcId(adrian, "post_collaboration_message", { p_channel_id: GENERAL, p_parent_message_id: null, p_body: "   \n  " }), null);
  expect("S: for lang melding avvises", await rpcId(adrian, "post_collaboration_message", { p_channel_id: GENERAL, p_parent_message_id: null, p_body: "x".repeat(4001) }), null);

  expect("10: bare-representant kan ikke lese meldinger", await count(miaminge, "collaboration_messages", { collaboration_id: C }), 0);
  expect("10: bare-representant kan ikke poste", await rpcId(miaminge, "post_collaboration_message", { p_channel_id: GENERAL, p_parent_message_id: null, p_body: "Hei" }), null);
  expect("11: uvalgt TU-moderator kan ikke lese", await count(hanne, "collaboration_messages", { collaboration_id: C }), 0);
  expect("11: uvalgt TU-moderator kan ikke poste", await rpcId(hanne, "post_collaboration_message", { p_channel_id: GENERAL, p_parent_message_id: null, p_body: "Hei" }), null);
  expect("11: bruker uten relasjon kan ikke lese", await count(sofie, "collaboration_messages", { collaboration_id: C }), 0);
  expect("11: anonym kan ikke lese", refusedOrEmpty(await anon.from("collaboration_messages").select("id")), true);

  expect("S: forfatter kan redigere egen melding", await rpcOk(kristoffer, "edit_collaboration_message", { p_message_id: M_k, p_body: "Hei fra FTR Oslo! Jeg tar grafikken til Kristiania." }), true);
  expect("S: redigering stempler edited_at", (await admin.from("collaboration_messages").select("edited_at").eq("id", M_k!).single()).data?.edited_at !== null, true);
  expect("S: andre kan ikke redigere meldingen", await rpcOk(adrian, "edit_collaboration_message", { p_message_id: M_k, p_body: "Kapret" }), false);
  expect("S: forvalter kan ikke redigere andres melding", await rpcOk(emma, "edit_collaboration_message", { p_message_id: M_k, p_body: "Kapret" }), false);
  const M_adrian = await rpcId(adrian, "post_collaboration_message", { p_channel_id: GENERAL, p_parent_message_id: null, p_body: "Feilpostet" });
  expect("S: andre medlemmer kan ikke slette meldingen", await rpcOk(kristoffer, "delete_collaboration_message", { p_message_id: M_adrian }), false);
  expect("S: forvalter uten tilgang kan ikke moderere", await rpcOk(miaminge, "delete_collaboration_message", { p_message_id: M_adrian }), false);
  expect("S: forvalter med tilgang kan moderere", await rpcOk(emma, "delete_collaboration_message", { p_message_id: M_adrian }), true);
  const deleted = (await admin.from("collaboration_messages").select("body, deleted_at, deleted_by_user_id").eq("id", M_adrian!).single()).data!;
  expect("S: slettet melding beholder ingen tekst", `${deleted.body}|${deleted.deleted_at !== null}|${deleted.deleted_by_user_id}`, `|true|${ids.emma}`);
  expect("S: slettet melding kan ikke redigeres", await rpcOk(adrian, "edit_collaboration_message", { p_message_id: M_adrian, p_body: "Tilbake" }), false);

  // 14. Identity: what the team reads about an author is the collaboration
  // persona. The account and the community personas stay closed.
  const kProfile = (await adrian.from("collaboration_profiles").select("display_name").eq("collaboration_id", C).eq("user_id", ids.kristoffer).maybeSingle()).data;
  const kAccount = (await admin.from("profiles").select("name").eq("id", ids.kristoffer).single()).data!;
  expect("14: forfatteren vises med samarbeidsprofilen", kProfile?.display_name, "Kristoffer i Oslo");
  expect("14: samarbeidsnavnet er ikke kontonavnet", kProfile?.display_name !== kAccount.name, true);
  expect("14: teamkollega kan ikke lese forfatterens konto", await count(adrian, "profiles", { id: ids.kristoffer }), 0);
  expect("14: teamkollega kan ikke lese forfatterens FTR-profil", await count(adrian, "community_profiles", { user_id: ids.kristoffer, community_id: FTR }), 0);

  // ══ THREADS (15–18) ═════════════════════════════════════════════════

  const R1 = await rpcId(adrian, "post_collaboration_message", { p_channel_id: PROGRAM, p_parent_message_id: M_q, p_body: "Jeg kan spørre Kristiania." });
  expect("15: medlem kan svare i tråd", typeof R1, "string");
  expect("15: svar fra annen organisasjon", typeof (await rpcId(kristoffer, "post_collaboration_message", { p_channel_id: PROGRAM, p_parent_message_id: M_q, p_body: "FTR Oslo foreslår en forsker." })), "string");
  expect("16: svar må ligge i samme kanal som tråden", await rpcId(adrian, "post_collaboration_message", { p_channel_id: GENERAL, p_parent_message_id: M_q, p_body: "Feil kanal" }), null);
  const other = await admin.from("collaboration_messages").insert({ collaboration_id: C, channel_id: GENERAL, author_id: ids.adrian, parent_message_id: M_q, body: "Service role" });
  expect("16: FK stopper svar i en annen kanal enn foreldermeldingen", other.error !== null, true);
  expect("18: svar på svar avvises (én tråd-dybde)", await rpcId(kristoffer, "post_collaboration_message", { p_channel_id: PROGRAM, p_parent_message_id: R1, p_body: "Dypt" }), null);
  const deep = await admin.from("collaboration_messages").insert({ collaboration_id: C, channel_id: PROGRAM!, author_id: ids.adrian, parent_message_id: R1, body: "Dypt" });
  expect("18: trigger stopper svar på svar også uten funksjonen", deep.error !== null, true);
  expect("S: svar på slettet melding avvises", await rpcId(adrian, "post_collaboration_message", { p_channel_id: GENERAL, p_parent_message_id: M_adrian, p_body: "Hei" }), null);
  const C2_GENERAL = (await admin.from("collaboration_channels").select("id").eq("collaboration_id", C2).single()).data!.id;
  const M_c2 = await rpcId(octavio, "post_collaboration_message", { p_channel_id: C2_GENERAL, p_parent_message_id: null, p_body: "UTR-intern" });
  expect("17: forelder fra et annet samarbeid avvises (Ingrid er i begge)", await rpcId(ingrid, "post_collaboration_message", { p_channel_id: PROGRAM, p_parent_message_id: M_c2, p_body: "Kryss" }), null);
  expect("17: og omvendt", await rpcId(ingrid, "post_collaboration_message", { p_channel_id: C2_GENERAL, p_parent_message_id: M_q, p_body: "Kryss" }), null);
  const crossParent = await admin.from("collaboration_messages").insert({ collaboration_id: C, channel_id: PROGRAM!, author_id: ids.ingrid, parent_message_id: M_c2, body: "Kryss" });
  expect("17: FK stopper forelder på tvers av samarbeid", crossParent.error !== null, true);
  expect("S: tråden har to svar", seen(await adrian.from("collaboration_messages").select("id").eq("parent_message_id", M_q!)), 2);

  // ══ TASKS (19–25) ═══════════════════════════════════════════════════

  const createTask = (client: Client, collaborationId: string, title: string, assignees: string[], extra: Record<string, unknown> = {}) =>
    rpcId(client, "create_collaboration_task", {
      p_collaboration_id: collaborationId,
      p_title: title,
      p_description: null,
      p_due_on: null,
      p_related_channel_id: null,
      p_related_document_id: null,
      p_related_event_id: null,
      p_assignee_ids: assignees,
      ...extra,
    });

  const T1 = await createTask(adrian, C, "Bekreft paneldeltakere", [ids.adrian, ids.kristoffer], { p_due_on: "2026-10-20", p_related_channel_id: PROGRAM });
  expect("20: vanlig medlem kan opprette oppgave", typeof T1, "string");
  expect("20: …med ansvarlige fra begge organisasjoner", seen(await adrian.from("collaboration_task_assignees").select("user_id").eq("task_id", T1!)), 2);
  const T2 = await createTask(kristoffer, C, "Send grafikk til Kristiania", [ids.kristoffer]);
  const T3 = await createTask(emma, C, "Sett opp frivilligvakter", []);
  expect("19: effektive medlemmer leser oppgavene", await count(ingrid, "collaboration_tasks", { collaboration_id: C }), 3);
  expect("21: tildeling til uvalgt TU-medlem avvises", await createTask(adrian, C, "Kapret", [ids.hanne]), null);
  expect("22: tildeling til uvalgt FTR Oslo-medlem avvises", await createTask(adrian, C, "Kapret", [ids.amina]), null);
  expect("22: tildeling til bare-representant avvises", await createTask(adrian, C, "Kapret", [ids.miaminge]), null);
  expect("22: tildeling til oppdiktet id avvises", await createTask(adrian, C, "Kapret", [randomUUID()]), null);
  const notMember = await admin.from("collaboration_task_assignees").insert({ task_id: T3!, collaboration_id: C, user_id: ids.hanne });
  expect("21: FK stopper en ansvarlig som aldri ble med", notMember.error !== null, true);
  expect("24: tildeling til C2-medlem i C avvises", await createTask(ingrid, C, "Kryss", [ids.octavio]), null);
  const crossAssignee = await admin.from("collaboration_task_assignees").insert({ task_id: T3!, collaboration_id: C, user_id: ids.octavio });
  expect("24: FK stopper C2-medlem som ansvarlig i C", crossAssignee.error !== null, true);
  const crossTaskCollab = await admin.from("collaboration_task_assignees").insert({ task_id: T3!, collaboration_id: C2, user_id: ids.ingrid });
  expect("24: FK stopper oppgave/samarbeid-par som ikke stemmer", crossTaskCollab.error !== null, true);
  expect("24: lenke til en kanal i et annet samarbeid avvises", await createTask(ingrid, C, "Kryss", [], { p_related_channel_id: C2_GENERAL }), null);

  expect("23: bare-representant leser ingen oppgaver", await count(miaminge, "collaboration_tasks", { collaboration_id: C }), 0);
  expect("23: bare-representant leser ingen ansvarlige", await count(miaminge, "collaboration_task_assignees", { collaboration_id: C }), 0);
  expect("23: bare-representant kan ikke opprette oppgave", await createTask(miaminge, C, "Mia", []), null);
  expect("23: uvalgt medlem leser ingen oppgaver", await count(hanne, "collaboration_tasks", { collaboration_id: C }), 0);

  expect("25: ansvarlig kan sette status", await rpcOk(kristoffer, "set_collaboration_task_status", { p_task_id: T1, p_status: "in_progress" }), true);
  expect("25: ansvarlig kan ikke avbryte andres oppgave", await rpcOk(kristoffer, "set_collaboration_task_status", { p_task_id: T1, p_status: "cancelled" }), false);
  expect("25: ansvarlig kan ikke redigere andres oppgave", await rpcOk(kristoffer, "update_collaboration_task", { p_task_id: T1, p_title: "Kapret", p_description: null, p_due_on: null, p_related_channel_id: null, p_related_document_id: null, p_related_event_id: null }), false);
  expect("25: ikke-ansvarlig medlem kan ikke endre status", await rpcOk(ingrid, "set_collaboration_task_status", { p_task_id: T2, p_status: "done" }), false);
  expect("25: skaperen kan redigere egen oppgave", await rpcOk(adrian, "update_collaboration_task", { p_task_id: T1, p_title: "Bekreft paneldeltakere (panel 1 og 2)", p_description: "Se tråden i #program", p_due_on: "2026-10-18", p_related_channel_id: PROGRAM, p_related_document_id: null, p_related_event_id: null }), true);
  expect("25: skaperen kan endre ansvarlige blant teamet", await rpcOk(adrian, "set_collaboration_task_assignees", { p_task_id: T1, p_assignee_ids: [ids.adrian, ids.kristoffer, ids.emma] }), true);
  expect("25: …men ikke legge til en utenforstående", await rpcOk(adrian, "set_collaboration_task_assignees", { p_task_id: T1, p_assignee_ids: [ids.adrian, ids.hanne] }), false);
  expect("25: forvalter med tilgang kan redigere andres oppgave", await rpcOk(emma, "update_collaboration_task", { p_task_id: T2, p_title: "Send grafikk til Kristiania innen fredag", p_description: null, p_due_on: "2026-10-09", p_related_channel_id: null, p_related_document_id: null, p_related_event_id: null }), true);
  expect("25: forvalter med tilgang kan tildele", await rpcOk(emma, "set_collaboration_task_assignees", { p_task_id: T2, p_assignee_ids: [ids.kristoffer, ids.ingrid] }), true);
  expect("25: forvalter med tilgang kan avbryte", await rpcOk(emma, "set_collaboration_task_status", { p_task_id: T2, p_status: "cancelled" }), true);
  expect("25: ansvarlig (ikke skaper) kan ikke gjenåpne avbrutt oppgave", await rpcOk(ingrid, "set_collaboration_task_status", { p_task_id: T2, p_status: "todo" }), false);
  expect("25: ansvarlig (ikke skaper) kan ikke avbryte", await rpcOk(ingrid, "set_collaboration_task_status", { p_task_id: T1, p_status: "cancelled" }), false);
  expect("25: forvalter gjenåpner", await rpcOk(emma, "set_collaboration_task_status", { p_task_id: T2, p_status: "todo" }), true);
  expect("25: forvalter uten tilgang kan ikke administrere oppgaver", await rpcOk(miaminge, "set_collaboration_task_status", { p_task_id: T2, p_status: "cancelled" }), false);
  expect("S: ferdig stempler completed_at", `${await rpcOk(adrian, "set_collaboration_task_status", { p_task_id: T1, p_status: "done" })}|${(await admin.from("collaboration_tasks").select("completed_at").eq("id", T1!).single()).data?.completed_at !== null}`, "true|true");
  expect("S: direkte UPDATE av oppgave avvises", refusedOrEmpty(await (adrian as unknown as Loose).from("collaboration_tasks").update({ title: "Kapret" }).eq("id", T3!).select("id")), true);

  // ══ DOCUMENTS (26–31) ═══════════════════════════════════════════════

  const D1 = await rpcId(adrian, "create_collaboration_document", { p_collaboration_id: C, p_title: "Programutkast", p_content: "18.00 Dører\n18.30 Panel 1" });
  expect("27: medlem kan opprette dokument", typeof D1, "string");
  const D2 = await rpcId(kristoffer, "create_collaboration_document", { p_collaboration_id: C, p_title: "Kveldens kjøreplan", p_content: "" });
  const D3 = await rpcId(emma, "create_collaboration_document", { p_collaboration_id: C, p_title: "Presse-/SoMe-tekst", p_content: "Utkast" });
  expect("27: to organisasjoner, tre dokumenter", [D1, D2, D3].every((d) => typeof d === "string"), true);
  expect("26: effektivt medlem leser dokumentene", await count(ingrid, "collaboration_documents", { collaboration_id: C }), 3);
  expect("28: bare-representant leser ingen dokumenter", await count(miaminge, "collaboration_documents", { collaboration_id: C }), 0);
  expect("28: bare-representant leser ingen versjoner", await count(miaminge, "collaboration_document_versions", { collaboration_id: C }), 0);
  expect("28: bare-representant kan ikke opprette dokument", await rpcId(miaminge, "create_collaboration_document", { p_collaboration_id: C, p_title: "Mia", p_content: "" }), null);
  expect("29: uvalgt medlem leser ingen dokumenter", await count(amina, "collaboration_documents", { collaboration_id: C }), 0);
  expect("29: anonym leser ingen dokumenter", refusedOrEmpty(await anon.from("collaboration_documents").select("id")), true);

  const save = async (client: Client, doc: string, expected: number, title: string, content: string) => {
    const { data, error } = await rpc(client, "save_collaboration_document", { p_document_id: doc, p_expected_revision: expected, p_title: title, p_content: content });
    const row = (Array.isArray(data) ? data[0] : data) as { save_result: string | null; saved_revision: number | null } | null;
    return error ? `feil: ${error.message}` : `${row?.save_result}|${row?.saved_revision}`;
  };
  expect("27: medlem fra den andre organisasjonen lagrer", await save(kristoffer, D1!, 1, "Programutkast", "18.00 Dører\n18.30 Panel 1\n19.30 Panel 2"), "saved|2");
  expect("31: lagring basert på gammel versjon gir konflikt", await save(adrian, D1!, 1, "Programutkast", "18.00 Dører (overskrevet)"), "conflict|2");
  expect("31: konflikten skrev ingenting", (await admin.from("collaboration_documents").select("content, revision").eq("id", D1!).single()).data?.revision, 2);
  expect("31: uendret innhold lager ingen versjon", await save(adrian, D1!, 2, "Programutkast", "18.00 Dører\n18.30 Panel 1\n19.30 Panel 2"), "unchanged|2");
  expect("31: hver lagring beholdes som versjon", seen(await adrian.from("collaboration_document_versions").select("revision").eq("document_id", D1!)), 2);
  const v1 = (await adrian.from("collaboration_document_versions").select("content").eq("document_id", D1!).eq("revision", 1).single()).data!;
  expect("31: en tidligere versjon kan gjenopprettes som ny versjon", await save(adrian, D1!, 2, "Programutkast", v1.content), "saved|3");
  expect("31: gjenopprettet innhold er versjon 1", (await admin.from("collaboration_documents").select("content").eq("id", D1!).single()).data?.content, v1.content);
  expect("S: bare-representant kan ikke lagre", await save(miaminge, D1!, 3, "Kapret", "Kapret"), "null|null");
  expect("S: vanlig medlem kan ikke arkivere dokument", await rpcOk(adrian, "set_collaboration_document_status", { p_document_id: D3, p_status: "archived" }), false);
  expect("S: forvalter uten tilgang kan ikke arkivere", await rpcOk(miaminge, "set_collaboration_document_status", { p_document_id: D3, p_status: "archived" }), false);
  expect("S: forvalter med tilgang kan arkivere", await rpcOk(emma, "set_collaboration_document_status", { p_document_id: D3, p_status: "archived" }), true);
  expect("S: arkivert dokument kan ikke lagres", await save(emma, D3!, 1, "Presse", "Ny"), "null|null");
  expect("S: arkivert dokument er fortsatt lesbart", await count(adrian, "collaboration_documents", { id: D3! }), 1);
  await rpcOk(emma, "set_collaboration_document_status", { p_document_id: D3, p_status: "active" });

  // ══ FILES (32–38) ═══════════════════════════════════════════════════

  const plakat = await uploadAndRegister(emma, C, "plakat.pdf", PDF, "application/pdf", "pdf");
  const program = await uploadAndRegister(kristoffer, C, "program.pdf", PDF, "application/pdf", "pdf");
  const photo = await uploadAndRegister(adrian, C, "speaker-photo.webp", PNG, "image/png", "png");
  expect("32: medlemmer laster opp (plakat, program, bilde)", [plakat.id, program.id, photo.id].every((id) => typeof id === "string"), true);
  const fileRow = (await admin.from("collaboration_files").select("storage_path, size_bytes, display_name").eq("id", program.id!).single()).data!;
  expect("S: objektnavnet er kanonisk og uten filnavn", fileRow.storage_path, `${C}/${program.id}.pdf`);
  expect("S: størrelsen leses fra lagringen, ikke klienten", fileRow.size_bytes, PDF.length);
  expect("32: medlem lister filene", await count(ingrid, "collaboration_files", { collaboration_id: C }), 3);
  expect("32: medlem fra annen organisasjon laster ned", await canDownload(adrian, "collaboration-files", program.path), true);
  expect("33: bare-representant lister ingen filer", await count(miaminge, "collaboration_files", { collaboration_id: C }), 0);
  expect("33: bare-representant kan ikke laste ned", await canDownload(miaminge, "collaboration-files", plakat.path), false);
  expect("33: bare-representant kan ikke laste opp", await upload(miaminge, "collaboration-files", `${C}/${randomUUID()}.pdf`, PDF, "application/pdf"), false);
  expect("34: uvalgt medlem kan ikke laste ned", await canDownload(hanne, "collaboration-files", plakat.path), false);
  expect("34: uvalgt medlem lister ingen filer", await count(hanne, "collaboration_files", { collaboration_id: C }), 0);
  expect("35: anonym kan ikke laste ned", await canDownload(anon, "collaboration-files", plakat.path), false);
  expect("35: anonym kan ikke liste bøtta", ((await anon.storage.from("collaboration-files").list(C)).data ?? []).length, 0);
  expect("35: bøtta er privat", sql("select public::text from storage.buckets where id = 'collaboration-files'"), "false");
  const signedAnon = await anon.storage.from("collaboration-files").createSignedUrl(plakat.path, 60);
  expect("35: anonym kan ikke lage signert lenke", signedAnon.error !== null, true);

  // 36. Path tampering and cross-collaboration.
  const c2File = await uploadAndRegister(octavio, C2, "utr-intern.pdf", PDF, "application/pdf", "pdf");
  expect("36: (oppsett) C2 har en fil", typeof c2File.id, "string");
  expect("36: C-medlem kan ikke laste ned C2-fil", await canDownload(emma, "collaboration-files", c2File.path), false);
  expect("36: C-medlem kan ikke laste opp i C2-mappen", await upload(emma, "collaboration-files", `${C2}/${randomUUID()}.pdf`, PDF, "application/pdf"), false);
  expect("36: navn utenfor formatet avvises", await upload(adrian, "collaboration-files", `${C}/../${C2}/x.pdf`, PDF, "application/pdf"), false);
  expect("36: filnavn i objektnavnet avvises", await upload(adrian, "collaboration-files", `${C}/plakat.pdf`, PDF, "application/pdf"), false);
  const stray = `${C}/${randomUUID()}.pdf`;
  await upload(adrian, "collaboration-files", stray, PDF, "application/pdf");
  expect("36: andres uregistrerte objekt kan ikke registreres", await rpcId(kristoffer, "register_collaboration_file", { p_collaboration_id: C, p_file_id: stray.split("/")[1].split(".")[0], p_display_name: "x", p_mime_type: "application/pdf" }), null);
  expect("36: andres uregistrerte objekt kan ikke leses", await canDownload(kristoffer, "collaboration-files", stray), false);
  expect("36: registrering i feil samarbeid avvises", await rpcId(ingrid, "register_collaboration_file", { p_collaboration_id: C2, p_file_id: stray.split("/")[1].split(".")[0], p_display_name: "x", p_mime_type: "application/pdf" }), null);
  expect("36: registrering med annen type enn lagret avvises", await rpcId(adrian, "register_collaboration_file", { p_collaboration_id: C, p_file_id: stray.split("/")[1].split(".")[0], p_display_name: "x", p_mime_type: "image/png" }), null);
  expect("36: dobbelregistrering avvises", await rpcId(emma, "register_collaboration_file", { p_collaboration_id: C, p_file_id: plakat.id, p_display_name: "igjen", p_mime_type: "application/pdf" }), null);
  const discard = await adrian.storage.from("collaboration-files").remove([stray]);
  expect("S: eget uregistrert objekt kan ryddes bort", (discard.data ?? []).length, 1);
  const deleteRegistered = await emma.storage.from("collaboration-files").remove([plakat.path]);
  expect("S: registrerte objekter kan ikke slettes via lagrings-API", (deleteRegistered.data ?? []).length, 0);
  expect("S: …og finnes fortsatt", await canDownload(adrian, "collaboration-files", plakat.path), true);

  // 37. Types. The bucket refuses what it was not configured for; the app
  // decides from bytes before it ever gets that far.
  expect("37: bøtta avviser kjørbare filer", await upload(adrian, "collaboration-files", `${C}/${randomUUID()}.pdf`, new TextEncoder().encode("MZ\x90\x00"), "application/x-msdownload"), false);
  expect("37: bøtta avviser HTML", await upload(adrian, "collaboration-files", `${C}/${randomUUID()}.txt`, new TextEncoder().encode("<html></html>"), "text/html"), false);
  expect("37: EXE-bytes gjenkjennes ikke", detectCollaborationFileType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]), "program.pdf"), undefined);
  expect("37: HTML kalt .txt avvises", detectCollaborationFileType(new TextEncoder().encode("<!doctype html><script>x</script>"), "notat.txt"), undefined);
  expect("37: SVG avvises", detectCollaborationFileType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), "logo.txt"), undefined);
  expect("37: zip uten Office-innhold avvises som .docx", detectCollaborationFileType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), "brev.docx"), undefined);
  expect("37: PDF gjenkjennes fra innholdet", detectCollaborationFileType(PDF, "plakat.pdf")?.mimeType, "application/pdf");
  expect("37: PDF kalt .exe er fortsatt en PDF — filnavnet bestemmer ikke", detectCollaborationFileType(PDF, "plakat.exe")?.extension, "pdf");
  expect("37: vanlig tekst godtas", detectCollaborationFileType(new TextEncoder().encode("Kjøreplan\n18.00"), "plan.txt")?.mimeType, "text/plain");
  expect("37: ukjent binær avvises", detectCollaborationFileType(new Uint8Array([0, 1, 2, 3, 4, 5]), "data.bin"), undefined);

  expect("S: vanlig medlem kan ikke fjerne andres fil", await rpcOk(kristoffer, "remove_collaboration_file", { p_file_id: plakat.id }), false);
  const extra = await uploadAndRegister(adrian, C, "gammel-plakat.pdf", PDF, "application/pdf", "pdf");
  expect("S: opplasteren kan fjerne egen fil", await rpcOk(adrian, "remove_collaboration_file", { p_file_id: extra.id }), true);
  expect("S: fjernet fil er borte fra listen", await count(adrian, "collaboration_files", { id: extra.id! }), 0);
  expect("S: fjernet fil kan ikke lastes ned", await canDownload(adrian, "collaboration-files", extra.path), false);
  expect("S: forvalter uten tilgang kan ikke fjerne filer", await rpcOk(miaminge, "remove_collaboration_file", { p_file_id: program.id }), false);

  // ── The upload route (HTTP, against the running app) ────────────────
  // The form posts here rather than to a server action, so the file cap does
  // not widen every action's request limit. Needs the app running at
  // CHECK_BASE_URL (default http://localhost:3000), like check:demo-entry.
  try {
    await fetch(`${BASE}/login`, { redirect: "manual" });
  } catch {
    throw new Error(`opplastingsruten kan ikke testes: appen svarer ikke på ${BASE} (kjør npm run dev)`);
  }
  const C_slug = (await admin.from("collaborations").select("slug").eq("id", C).single()).data!.slug;
  const C2_slug = (await admin.from("collaborations").select("slug").eq("id", C2).single()).data!.slug;
  const [emmaCookie, larsCookie, ingridCookie] = await Promise.all([
    sessionCookie("emmamortensen"),
    sessionCookie("miaminge"),
    sessionCookie("ingrid"),
  ]);
  const pdfFile = { bytes: PDF, name: "plakat-rute.pdf", type: "application/pdf" };
  const filesIn = async (collaborationId: string) =>
    (await admin.from("collaboration_files").select("id").eq("collaboration_id", collaborationId)).data?.length ?? 0;
  const before = await filesIn(C);

  expect("UP: uinnlogget opplasting avvises (401)", (await uploadViaRoute(C_slug, pdfFile)).status, 401);
  expect("UP: opplasting fra et annet opphav avvises (403)", (await uploadViaRoute(C_slug, pdfFile, { cookie: emmaCookie, origin: "https://evil.example" })).status, 403);
  expect("UP: bare-representant avvises før kroppen leses (403)", (await uploadViaRoute(C_slug, pdfFile, { cookie: larsCookie })).status, 403);
  expect("UP: samarbeid uten relasjon er ikke funnet (404)", (await uploadViaRoute(C2_slug, pdfFile, { cookie: emmaCookie })).status, 404);
  const overCap = new Uint8Array(8 * 1024 * 1024 + 1);
  overCap.set(PDF);
  expect("UP: 8 MiB + 1 byte avvises (413)", (await uploadViaRoute(C_slug, { ...pdfFile, bytes: overCap }, { cookie: emmaCookie })).status, 413);
  const wayOver = new Uint8Array(9 * 1024 * 1024);
  wayOver.set(PDF);
  expect("UP: 9 MiB avvises på oppgitt størrelse (413)", (await uploadViaRoute(C_slug, { ...pdfFile, bytes: wayOver }, { cookie: emmaCookie })).status, 413);
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
  expect("UP: forkledd kjørbar fil kalt .pdf avvises (415)", (await uploadViaRoute(C_slug, { bytes: exe, name: "program.pdf", type: "application/pdf" }, { cookie: emmaCookie })).status, 415);
  expect("UP: HTML kalt .txt avvises (415)", (await uploadViaRoute(C_slug, { bytes: new TextEncoder().encode("<!doctype html><script>alert(1)</script>"), name: "notat.txt", type: "text/plain" }, { cookie: emmaCookie })).status, 415);
  expect("UP: ingen av de avviste ble lagret", await filesIn(C), before);

  const valid = await uploadViaRoute(C_slug, pdfFile, { cookie: emmaCookie, displayName: "Plakat (rute)" });
  expect("UP: gyldig opplasting lykkes (201)", `${valid.status}|${typeof valid.id}`, "201|string");
  const routed = (await admin.from("collaboration_files").select("collaboration_id, storage_path, uploaded_by_user_id, display_name, size_bytes").eq("id", valid.id!).single()).data!;
  expect("UP: filen ligger i riktig samarbeid, lastet opp av den innloggede", `${routed.collaboration_id}|${routed.uploaded_by_user_id}|${routed.display_name}`, `${C}|${ids.emma}|Plakat (rute)`);
  expect("UP: objektnavnet er kanonisk (ingen klientsti)", routed.storage_path, `${C}/${valid.id}.pdf`);
  uploaded.push({ bucket: "collaboration-files", path: routed.storage_path });
  const exact = new Uint8Array(8 * 1024 * 1024);
  exact.set(PDF);
  const atCap = await uploadViaRoute(C_slug, { ...pdfFile, bytes: exact }, { cookie: emmaCookie });
  expect("UP: nøyaktig 8 MiB godtas", atCap.status, 201);
  if (atCap.id) uploaded.push({ bucket: "collaboration-files", path: `${C}/${atCap.id}.pdf` });
  const steered = await uploadViaRoute(C_slug, pdfFile, { cookie: ingridCookie, extra: { collaborationId: C2, path: `${C2}/x.pdf`, storagePath: `${C2}/x.pdf` } });
  expect("UP: klientfelt kan ikke styre filen inn i et annet samarbeid", `${steered.status}|${(await admin.from("collaboration_files").select("collaboration_id").eq("id", steered.id!).single()).data?.collaboration_id}`, `201|${C}`);
  if (steered.id) uploaded.push({ bucket: "collaboration-files", path: `${C}/${steered.id}.pdf` });
  expect("UP: ingenting havnet i C2", await filesIn(C2), 1);
  expect("UP: bøtta er fortsatt privat", sql("select public::text from storage.buckets where id = 'collaboration-files'"), "false");
  expect("UP: ruten er dynamisk og bruker ingen service-role", /createSupabaseAdminClient|SERVICE_ROLE|supabaseServiceRoleKey/.test(readFileSync("app/(app)/collaboration/[slug]/files/upload/route.ts", "utf8")), false);
  expect("UP: den globale grensen for server actions er uendret (6mb)", /bodySizeLimit:\s*"6mb"/.test(readFileSync("next.config.ts", "utf8")), true);

  // ══ EVENT PLANNING (39–44) ══════════════════════════════════════════

  const NOTE = "INTERNT-NOTAT-7f3a: Budsjett 12 000, talerhonorar forhandles";
  const eventArgs = (overrides: Record<string, unknown> = {}) => ({
    p_title: "Seminar: Strategier, markedsføring og differensiering",
    p_description: "Et åpent seminar om hvordan det illegale markedet konkurrerer.",
    p_internal_notes: NOTE,
    p_starts_at: "2026-10-22T16:00:00Z",
    p_ends_at: "2026-10-22T19:00:00Z",
    p_location: "Høyskolen Kristiania, Kirkegata 24",
    p_audience: "public",
    p_registration_url: "https://example.org/pamelding",
    p_status: "confirmed",
    ...overrides,
  });
  const E1 = await rpcId(emma, "create_collaboration_event", { p_collaboration_id: C, ...eventArgs() });
  expect("42: forvalter med tilgang oppretter arrangement", typeof E1, "string");
  expect("43: forvalter uten tilgang kan ikke opprette", await rpcId(miaminge, "create_collaboration_event", { p_collaboration_id: C, ...eventArgs() }), null);
  expect("S: vanlig medlem kan ikke opprette arrangement", await rpcId(adrian, "create_collaboration_event", { p_collaboration_id: C, ...eventArgs() }), null);
  expect("S: et samarbeid kan planlegge flere arrangement", typeof (await rpcId(emma, "create_collaboration_event", { p_collaboration_id: C, ...eventArgs({ p_title: "Oppfølgingsmøte", p_audience: "invite_only", p_status: "draft", p_internal_notes: null }) })), "string");
  expect("S: slutt før start avvises", await rpcId(emma, "create_collaboration_event", { p_collaboration_id: C, ...eventArgs({ p_ends_at: "2026-10-22T15:00:00Z" }) }), null);
  expect("S: javascript:-lenke avvises", await rpcId(emma, "create_collaboration_event", { p_collaboration_id: C, ...eventArgs({ p_registration_url: "javascript:alert(1)" }) }), null);
  expect("39: medlem leser den private planen", await count(adrian, "collaboration_events", { id: E1! }), 1);
  expect("39: medlem leser de interne notatene", (await adrian.from("collaboration_events").select("internal_notes").eq("id", E1!).single()).data?.internal_notes, NOTE);
  expect("40: bare-representant leser ikke planen", await count(miaminge, "collaboration_events", { id: E1! }), 0);
  expect("41: målgruppe «åpent for alle» gjør ikke planen offentlig (anonym)", refusedOrEmpty(await anon.from("collaboration_events").select("id").eq("id", E1!)), true);
  expect("41: …eller lesbar for innloggede utenforstående", await count(sofie, "collaboration_events", { id: E1! }), 0);
  expect("44: uvalgt medlem leser ikke planen", await count(hanne, "collaboration_events", { id: E1! }), 0);
  expect("42: forvalter med tilgang redigerer", await rpcOk(emma, "update_collaboration_event", { p_event_id: E1, ...eventArgs({ p_location: "Høyskolen Kristiania, Oslo" }) }), true);
  expect("43: forvalter uten tilgang kan ikke redigere", await rpcOk(miaminge, "update_collaboration_event", { p_event_id: E1, ...eventArgs({ p_title: "Kapret" }) }), false);
  expect("S: vanlig medlem kan ikke redigere planen", await rpcOk(adrian, "update_collaboration_event", { p_event_id: E1, ...eventArgs({ p_title: "Kapret" }) }), false);

  // ══ PUBLIC PUBLISHING (45–56) ═══════════════════════════════════════

  expect("S: arrangørvalg: bare aktive enheter i samme samarbeid", await rpcOk(emma, "set_collaboration_event_organizers", { p_event_id: E1, p_participant_ids: [P_UTR] }), false);
  expect("S: vanlig medlem kan ikke velge arrangører", await rpcOk(adrian, "set_collaboration_event_organizers", { p_event_id: E1, p_participant_ids: [P_TU] }), false);
  expect("S: forvalter ber om TU og FTR Oslo som arrangører", await rpcOk(emma, "set_collaboration_event_organizers", { p_event_id: E1, p_participant_ids: [P_TU, P_OSLO] }), true);

  // PUBLIC ORGANISER CONSENT — each unit decides its own public appearance.
  const consents = async () =>
    ((await admin.from("collaboration_event_organizer_consents").select("participant_id").eq("event_id", E1!)).data ?? [])
      .map((row) => (row.participant_id === P_TU ? "TU" : row.participant_id === P_OSLO ? "OSLO" : "annen"))
      .sort()
      .join(",");
  const consent = (client: Client, participant: string | null, value: boolean, event = E1) =>
    rpcOk(client, "set_collaboration_event_organizer_consent", { p_event_id: event, p_participant_id: participant, p_consent: value });
  expect("PO: egen enhet (TU, som Emma representerer) er godkjent ved valget", await consents(), "TU");
  expect("PO: FTR Oslo er bare forespurt, ikke godkjent", (await consents()).includes("OSLO"), false);
  expect("PO: TU-forvalter kan ikke godkjenne for FTR Oslo", await consent(emma, P_OSLO, true), false);
  expect("PO: Oslo-medlem i teamet (ikke representant) kan ikke godkjenne", await consent(kristoffer, P_OSLO, true), false);
  expect("PO: vanlig TU-medlem kan ikke godkjenne", await consent(adrian, P_OSLO, true), false);
  expect("PO: uvedkommende admin (UTR) kan ikke godkjenne", await consent(octavio, P_OSLO, true), false);
  expect("PO: uvedkommende admin kan ikke trekke tilbake TUs godkjenning", await consent(octavio, P_TU, false), false);
  expect("PO: TU-forvalter kan ikke trekke tilbake for FTR Oslo", await consent(emma, P_OSLO, false), false);
  expect("PO: FTR-representanten kan ikke godkjenne for TU", await consent(miaminge, P_TU, true), false);
  expect("PO: deltaker fra et annet samarbeid avvises", await consent(octavio, P_UTR, true), false);
  const direct = await (emma as unknown as Loose).from("collaboration_event_organizer_consents").insert({ event_id: E1, collaboration_id: C, participant_id: P_OSLO });
  expect("PO: direkte INSERT av samtykke avvises", direct.error !== null, true);
  expect("PO: fortsatt ingen godkjenning for FTR Oslo", await consents(), "TU");

  // What the representative outside the team can see: their own unit's
  // request, and the event's publishable fields — nothing else changes.
  expect("PO: FTR-representanten ser forespørselen til sin egen enhet", await count(miaminge, "collaboration_event_public_organizers", { participant_id: P_OSLO! }), 1);
  expect("PO: …men ikke TUs rad", await count(miaminge, "collaboration_event_public_organizers", { participant_id: P_TU }), 0);
  expect("PO: …og ikke TUs godkjenning", await count(miaminge, "collaboration_event_organizer_consents", { participant_id: P_TU }), 0);
  const request = async (client: Client, participant: string | null) => {
    const { data } = await rpc(client, "collaboration_organizer_request", { p_event_id: E1, p_participant_id: participant });
    return ((Array.isArray(data) ? data[0] : data) ?? {}) as Record<string, unknown>;
  };
  const larsView = await request(miaminge, P_OSLO);
  expect("PO: representanten ser tittelen han blir bedt om å stå bak", larsView.title, "Seminar: Strategier, markedsføring og differensiering");
  expect("PO: representanten får bare publiserbare felt", Object.keys(larsView).sort().join(","), "audience,consented,ends_at,listed,location,starts_at,status,title");
  expect("PO: ingen interne notater i forespørselen", JSON.stringify(larsView).includes("INTERNT-NOTAT"), false);
  expect("PO: representanten får ingenting for en annen enhets forespørsel", (await request(miaminge, P_TU)).title ?? null, null);
  expect("PO: uvedkommende får ingenting", (await request(octavio, P_OSLO)).title ?? null, null);
  expect("PO: TU-forvalter får ikke FTR Oslos visning via funksjonen", (await request(emma, P_OSLO)).title ?? null, null);
  expect("PO: ingen andre tilgangsendringer — fortsatt ingen arbeidsflate-tilgang", await rpcOk(miaminge, "has_collaboration_access", { p_collaboration_id: C }), false);
  expect("PO: …ingen arrangementsplan", await count(miaminge, "collaboration_events", { collaboration_id: C }), 0);
  expect("PO: …ingen kanaler, dokumenter eller filer", `${await count(miaminge, "collaboration_channels", { collaboration_id: C })}|${await count(miaminge, "collaboration_documents", { collaboration_id: C })}|${await count(miaminge, "collaboration_files", { collaboration_id: C })}`, "0|0|0");
  expect("PO: …og ingen teamliste", await count(miaminge, "collaboration_members", { collaboration_id: C }), 0);
  expect("S: bildevalg må være et bilde fra samarbeidet", await rpcOk(emma, "set_collaboration_event_image", { p_event_id: E1, p_file_id: plakat.id }), false);
  expect("S: bildevalg fra C2 avvises", await rpcOk(emma, "set_collaboration_event_image", { p_event_id: E1, p_file_id: c2File.id }), false);
  expect("S: forvalter velger bildet", await rpcOk(emma, "set_collaboration_event_image", { p_event_id: E1, p_file_id: photo.id }), true);

  const draft = await rpcId(emma, "create_collaboration_event", { p_collaboration_id: C, ...eventArgs({ p_title: "Utkast", p_status: "draft" }) });
  expect("S: utkast kan ikke publiseres", await rpcId(emma, "publish_collaboration_event", { p_event_id: draft, p_image_path: null }), null);
  const inviteOnly = await rpcId(emma, "create_collaboration_event", { p_collaboration_id: C, ...eventArgs({ p_title: "Lukket", p_audience: "invite_only" }) });
  expect("S: arrangement for inviterte kan ikke publiseres", await rpcId(emma, "publish_collaboration_event", { p_event_id: inviteOnly, p_image_path: null }), null);

  expect("46: vanlig medlem kan ikke publisere", await rpcId(adrian, "publish_collaboration_event", { p_event_id: E1, p_image_path: null }), null);
  expect("47: bare-representant kan ikke publisere", await rpcId(miaminge, "publish_collaboration_event", { p_event_id: E1, p_image_path: null }), null);
  expect("S: uvalgt medlem kan ikke publisere", await rpcId(hanne, "publish_collaboration_event", { p_event_id: E1, p_image_path: null }), null);

  // The image is copied into the publication bucket by the manager first —
  // exactly what the publish action does.
  const assetKey = (await admin.from("collaboration_events").select("public_asset_key").eq("id", E1!).single()).data!.public_asset_key;
  const draftKey = (await admin.from("collaboration_events").select("public_asset_key").eq("id", draft!).single()).data!.public_asset_key;
  expect("S: bildemappa er en egen tilfeldig nøkkel, ikke arrangementets id", assetKey !== E1, true);
  const imagePath = `${assetKey}/${randomUUID()}.png`;
  expect("S: vanlig medlem kan ikke legge bilder i publiseringsbøtta", await upload(adrian, "published-event-images", `${assetKey}/${randomUUID()}.png`, PNG, "image/png"), false);
  expect("S: forvalter uten tilgang kan ikke legge bilder der", await upload(miaminge, "published-event-images", `${assetKey}/${randomUUID()}.png`, PNG, "image/png"), false);
  expect("S: mappe med arrangementets id (ikke nøkkelen) avvises", await upload(emma, "published-event-images", `${E1}/${randomUUID()}.png`, PNG, "image/png"), false);
  expect("S: forvalter med tilgang kopierer bildet", await upload(emma, "published-event-images", imagePath, PNG, "image/png"), true);
  expect("S: kopiert bilde er ikke offentlig før publisering", await canDownload(anon, "published-event-images", imagePath), false);
  const foreignImage = `${draftKey}/${randomUUID()}.png`;
  await upload(emma, "published-event-images", foreignImage, PNG, "image/png");
  expect("S: publisering med bilde fra et annet arrangements mappe avvises", await rpcId(emma, "publish_collaboration_event", { p_event_id: E1, p_image_path: foreignImage }), null);

  const slug = await rpcId(emma, "publish_collaboration_event", { p_event_id: E1, p_image_path: imagePath });
  expect("45: forvalter med tilgang publiserer", typeof slug, "string");
  const pub = await publicEvent(anon, slug!);
  expect("48: anonym leser den publiserte projeksjonen", pub.title, "Seminar: Strategier, markedsføring og differensiering");
  expect("48: tidspunkt og sted er med", `${pub.starts_at !== null}|${pub.location}`, "true|Høyskolen Kristiania, Oslo");
  expect("48: projeksjonen har bare de tillatte feltene", Object.keys(pub).sort().join(","), "audience,description,ends_at,image_path,is_cancelled,locale,location,organizers,public_slug,registration_url,starts_at,title,updated_at");
  expect("49: anonym leser ikke kildearrangementet", refusedOrEmpty(await anon.from("collaboration_events").select("*").eq("id", E1!)), true);
  expect("49: anonym leser ikke publikasjonstabellen direkte", refusedOrEmpty(await anon.from("published_collaboration_events").select("*")), true);
  const everything = JSON.stringify(pub);
  expect("50: ingen interne notater i projeksjonen", everything.includes("INTERNT-NOTAT"), false);
  expect("50: publikasjonstabellen har ingen notatkolonne", sql("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'published_collaboration_events' and column_name ilike '%note%'"), "0");
  expect("50: …og intet notat noe sted i raden", sql(`select (to_jsonb(p)::text ilike '%INTERNT-NOTAT%')::text from published_collaboration_events p where public_slug = '${slug}'`), "false");
  for (const name of ["Emma (TU)", "Adrian – frivillig", "Kristoffer i Oslo", "Ingrid Samarbeid"]) {
    expect(`51: ingen teamnavn i projeksjonen (${name})`, everything.includes(name), false);
  }
  for (const [label, id] of Object.entries(ids)) {
    expect(`52: ingen bruker-id i projeksjonen (${label})`, everything.includes(id), false);
  }
  for (const [label, id] of Object.entries({ C, P_TU, P_OSLO, S_kristoffer, E1, photo: photo.id })) {
    expect(`52: ingen privat id i projeksjonen (${label})`, everything.includes(id!), false);
  }
  const organizers = (pub.organizers as { communityName: string; localGroupName: string | null }[]).map((o) => `${o.communityName}${o.localGroupName ? ` / ${o.localGroupName}` : ""}`);
  expect("PO: TU kan ikke publisere FTR Oslo som arrangør på egen hånd", organizers.join(" + "), "Tryggere Ungdom");
  expect("S: arrangørene har ingen id-er", JSON.stringify(pub.organizers).match(/[0-9a-f]{8}-[0-9a-f]{4}-/) === null, true);
  expect("56: publisert bilde ligger i publiseringsbøtta", pub.image_path, imagePath);
  expect("56: anonym leser det publiserte bildet", await canDownload(anon, "published-event-images", imagePath), true);
  expect("56: anonym leser fortsatt ikke kildebildet i den private bøtta", await canDownload(anon, "collaboration-files", photo.path), false);
  expect("56: projeksjonen peker ikke inn i den private bøtta", everything.includes(photo.path) || everything.includes("collaboration-files"), false);
  expect("S: bare-representant ser ikke engang publiseringsstatusen", await count(miaminge, "published_collaboration_events", { source_event_id: E1! }), 0);
  expect("S: teamet ser publiseringsstatusen", await count(adrian, "published_collaboration_events", { source_event_id: E1! }), 1);

  const liveOrganizers = async () =>
    ((await publicEvent(anon, slug!)).organizers as { communityName: string; localGroupName: string | null }[] | undefined ?? [])
      .map((o) => `${o.communityName}${o.localGroupName ? ` / ${o.localGroupName}` : ""}`)
      .join(" + ");
  expect("PO: FTR Oslo-representanten godkjenner sin egen offentlige visning", await consent(miaminge, P_OSLO, true), true);
  expect("PO: godkjenning er idempotent", await consent(miaminge, P_OSLO, true), true);
  expect("PO: godkjenningen er registrert", await consents(), "OSLO,TU");
  expect("PO: godkjenningen er revidert med representanten som aktør", ((await admin.from("collaboration_audit_log").select("actor_user_id").eq("collaboration_id", C).eq("action", "organizer_consent_granted").eq("participant_id", P_OSLO!)).data ?? []).some((r) => r.actor_user_id === ids.miaminge), true);
  expect("PO: godkjenning publiserer ingenting av seg selv", await liveOrganizers(), "Tryggere Ungdom");
  expect("PO: representanten ser «godkjent, ikke vist ennå»", `${(await request(miaminge, P_OSLO)).consented}|${(await request(miaminge, P_OSLO)).listed}`, "true|false");
  expect("PO: (oppsett) forvalter oppdaterer publiseringen", await rpcId(emma, "publish_collaboration_event", { p_event_id: E1, p_image_path: null }), slug);
  expect("PO: etter godkjenning og oppdatering vises begge", await liveOrganizers(), "Tryggere Ungdom + Tryggere Ruspolitikk / FTR Oslo");
  expect("PO: representanten ser at enheten vises nå", (await request(miaminge, P_OSLO)).listed, true);
  expect("PO: fortsatt ingen id-er i de offentlige arrangørene", JSON.stringify((await publicEvent(anon, slug!)).organizers).match(/[0-9a-f]{8}-[0-9a-f]{4}-/) === null, true);

  // Revocation removes the unit from the live page at once.
  expect("PO: representanten trekker tilbake godkjenningen", await consent(miaminge, P_OSLO, false), true);
  expect("PO: enheten er borte fra den offentlige siden umiddelbart (uten ny publisering)", await liveOrganizers(), "Tryggere Ungdom");
  expect("PO: godkjenningen er borte", await consents(), "TU");
  expect("PO: tilbaketrekking er revidert", ((await admin.from("collaboration_audit_log").select("actor_user_id").eq("collaboration_id", C).eq("action", "organizer_consent_revoked").eq("participant_id", P_OSLO!)).data ?? []).some((r) => r.actor_user_id === ids.miaminge), true);
  expect("PO: tilbaketrekking er idempotent", await consent(miaminge, P_OSLO, false), true);
  expect("PO: neste oppdatering tar den ikke med igjen", `${await rpcId(emma, "publish_collaboration_event", { p_event_id: E1, p_image_path: null })}|${await liveOrganizers()}`, `${slug}|Tryggere Ungdom`);
  expect("PO: ny godkjenning vises først ved neste oppdatering", `${await consent(miaminge, P_OSLO, true)}|${await liveOrganizers()}`, "true|Tryggere Ungdom");

  // Taking a unit out of the selection drops its consent: asking again means
  // asking again.
  expect("PO: (oppsett) forvalter tar FTR Oslo ut av valget", await rpcOk(emma, "set_collaboration_event_organizers", { p_event_id: E1, p_participant_ids: [P_TU] }), true);
  expect("PO: utvalg fjerner godkjenningen", await consents(), "TU");
  expect("PO: en enhet som ikke er forespurt kan ikke godkjenne", await consent(miaminge, P_OSLO, true), false);
  expect("PO: forespørselen er borte for representanten", await count(miaminge, "collaboration_event_public_organizers", { participant_id: P_OSLO! }), 0);
  expect("PO: (oppsett) forespurt igjen", await rpcOk(emma, "set_collaboration_event_organizers", { p_event_id: E1, p_participant_ids: [P_TU, P_OSLO] }), true);
  expect("PO: gammel godkjenning følger ikke med", await consents(), "TU");
  expect("PO: (oppsett) representanten godkjenner på nytt og siden oppdateres", `${await consent(miaminge, P_OSLO, true)}|${await rpcId(emma, "publish_collaboration_event", { p_event_id: E1, p_image_path: null })}|${await liveOrganizers()}`, `true|${slug}|Tryggere Ungdom + Tryggere Ruspolitikk / FTR Oslo`);
  expect("PO: forespørsel på et arrangement enheten ikke er bedt om avvises", await consent(miaminge, P_OSLO, true, draft), false);

  // 53–54: a snapshot.
  expect("53: (oppsett) privat endring etter publisering", await rpcOk(emma, "update_collaboration_event", { p_event_id: E1, ...eventArgs({ p_title: "Seminar – NY TITTEL (privat)", p_location: "Høyskolen Kristiania, Oslo" }) }), true);
  expect("53: offentlig side er uendret til den oppdateres", (await publicEvent(anon, slug!)).title, "Seminar: Strategier, markedsføring og differensiering");
  expect("54: oppdatering gir samme adresse", await rpcId(emma, "publish_collaboration_event", { p_event_id: E1, p_image_path: null }), slug);
  expect("54: oppdatert publikasjon viser endringen", (await publicEvent(anon, slug!)).title, "Seminar – NY TITTEL (privat)");
  expect("54: samme valgte bilde beholdes ved oppdatering", (await publicEvent(anon, slug!)).image_path, imagePath);
  expect("S: avlysning kan publiseres", `${await rpcOk(emma, "update_collaboration_event", { p_event_id: E1, ...eventArgs({ p_title: "Seminar – NY TITTEL (privat)", p_status: "cancelled" }) })}|${await rpcId(emma, "publish_collaboration_event", { p_event_id: E1, p_image_path: null })}|${(await publicEvent(anon, slug!)).is_cancelled}`, `true|${slug}|true`);
  await rpcOk(emma, "update_collaboration_event", { p_event_id: E1, ...eventArgs({ p_title: "Seminar – NY TITTEL (privat)" }) });
  expect("S: bildevalget fjernes → bildet forsvinner ved neste oppdatering", `${await rpcOk(emma, "set_collaboration_event_image", { p_event_id: E1, p_file_id: null })}|${await rpcId(emma, "publish_collaboration_event", { p_event_id: E1, p_image_path: null })}|${(await publicEvent(anon, slug!)).image_path}`, `true|${slug}|null`);
  expect("S: bildet som ikke lenger er publisert kan ikke leses anonymt", await canDownload(anon, "published-event-images", imagePath), false);

  expect("55: vanlig medlem kan ikke avpublisere", await rpcOk(adrian, "unpublish_collaboration_event", { p_event_id: E1 }), false);
  expect("55: bare-representant kan ikke avpublisere", await rpcOk(miaminge, "unpublish_collaboration_event", { p_event_id: E1 }), false);
  expect("55: forvalter avpubliserer", await rpcOk(emma, "unpublish_collaboration_event", { p_event_id: E1 }), true);
  expect("55: anonym får ingenting etter avpublisering", (await publicEvent(anon, slug!)).public_slug ?? null, null);
  expect("55: den private planen er urørt", (await admin.from("collaboration_events").select("internal_notes").eq("id", E1!).single()).data?.internal_notes, NOTE);
  expect("55: publisering igjen gir samme adresse", await rpcId(emma, "publish_collaboration_event", { p_event_id: E1, p_image_path: null }), slug);
  expect("S: ukjent adresse gir ingenting", (await publicEvent(anon, "finnes-ikke")).public_slug ?? null, null);
  const log = (await admin.from("collaboration_audit_log").select("action, actor_user_id").eq("collaboration_id", C)).data ?? [];
  expect("S: publisering og avpublisering er revidert med aktør", ["event_published", "event_publication_updated", "event_unpublished"].every((a) => log.some((e) => e.action === a && e.actor_user_id === ids.emma)), true);

  // ══ ORGANISATION PRIVACY (57–61) ════════════════════════════════════

  expect("57: ingen policy på memberships nevner samarbeid", sql("select count(*) from pg_policies where schemaname = 'public' and tablename = 'memberships' and (coalesce(qual, '') ilike '%collaboration%' or coalesce(with_check, '') ilike '%collaboration%')"), "0");
  expect("57: TU-admin ser fortsatt ingen FTR-medlemskap", seen(await emma.from("memberships").select("id").eq("community_id", FTR)), 0);
  expect("57: Oslo-medlem i teamet ser ingen TU-medlemskap", seen(await kristoffer.from("memberships").select("id").eq("community_id", TU)), 0);
  expect("58: ingen policy på community_profiles nevner samarbeid", sql("select count(*) from pg_policies where schemaname = 'public' and tablename = 'community_profiles' and (coalesce(qual, '') ilike '%collaboration%' or coalesce(with_check, '') ilike '%collaboration%')"), "0");
  expect("58: teamkollega ser ingen TU-profiler for Adrian", await count(kristoffer, "community_profiles", { user_id: ids.adrian }), 0);
  expect("59: FTR-representanten kan ikke telle TU-medlemmer", seen(await miaminge.from("memberships").select("id").eq("community_id", TU)), 0);
  expect("59: TU-forvalteren kan ikke telle FTR Oslo-medlemmer", seen(await emma.from("memberships").select("id").eq("local_group_id", OSLO)), 0);
  expect("60: TU-forvalteren ser ingen FTR-lokallag", await count(emma, "community_local_groups", { community_id: FTR }), 0);
  expect("60: teamkollega ser ikke andre Oslo-medlemmer (Amina)", await count(adrian, "collaboration_members", { user_id: ids.amina }), 0);
  const team = new Set(((await adrian.from("collaboration_members").select("user_id").eq("collaboration_id", C)).data ?? []).map((r) => r.user_id));
  expect("61: teamet er bare de som ble med", [...team].sort().join(), [ids.emma, ids.adrian, ids.kristoffer, ids.ingrid].sort().join());
  const profiles = ((await adrian.from("collaboration_profiles").select("user_id").eq("collaboration_id", C)).data ?? []).map((r) => r.user_id);
  expect("61: samarbeidsprofilene er bare teamets", profiles.every((id) => team.has(id)), true);

  // ══ ACCESS REVOCATION (62–65, and 12/13/30/38) ══════════════════════

  // A signed URL issued while still a member, and a lapsed person who never
  // contributed (Petter), for the checks below.
  const shortLived = await kristoffer.storage.from("collaboration-files").createSignedUrl(program.path, 2);
  expect("65: (oppsett) medlem kan lage en kortlivet signert lenke", typeof shortLived.data?.signedUrl, "string");

  expect("62: (oppsett) FTR Oslo trekker Kristoffers eneste sponsing", await rpcOk(miaminge, "revoke_collaboration_sponsorship", { p_sponsorship_id: S_kristoffer }), true);
  expect("62: tilgangen er borte med én gang", await rpcOk(kristoffer, "has_collaboration_access", { p_collaboration_id: C }), false);
  expect("62: ingen kanaler", await count(kristoffer, "collaboration_channels", { collaboration_id: C }), 0);
  expect("12: ingen meldinger å lese", await count(kristoffer, "collaboration_messages", { collaboration_id: C }), 0);
  expect("12: kan ikke poste", await rpcId(kristoffer, "post_collaboration_message", { p_channel_id: GENERAL, p_parent_message_id: null, p_body: "Er jeg her?" }), null);
  expect("12: kan ikke svare i tråd", await rpcId(kristoffer, "post_collaboration_message", { p_channel_id: PROGRAM, p_parent_message_id: M_q, p_body: "Er jeg her?" }), null);
  expect("12: kan ikke redigere egen gamle melding", await rpcOk(kristoffer, "edit_collaboration_message", { p_message_id: M_k, p_body: "Endret etterpå" }), false);
  expect("62: ingen oppgaver", await count(kristoffer, "collaboration_tasks", { collaboration_id: C }), 0);
  expect("62: kan ikke endre status på egen oppgave", await rpcOk(kristoffer, "set_collaboration_task_status", { p_task_id: T2, p_status: "done" }), false);
  expect("62: ingen dokumenter", await count(kristoffer, "collaboration_documents", { collaboration_id: C }), 0);
  expect("62: kan ikke lagre dokument", await save(kristoffer, D2!, 1, "Kveldens kjøreplan", "Endret"), "null|null");
  expect("38: ingen filer i listen", await count(kristoffer, "collaboration_files", { collaboration_id: C }), 0);
  expect("38: kan ikke laste ned egen fil", await canDownload(kristoffer, "collaboration-files", program.path), false);
  expect("65: kan ikke lage ny signert lenke", (await kristoffer.storage.from("collaboration-files").createSignedUrl(program.path, 60)).error !== null, true);
  expect("62: ingen arrangement", await count(kristoffer, "collaboration_events", { collaboration_id: C }), 0);
  expect("62: ingen publiseringsstatus", await count(kristoffer, "published_collaboration_events", { collaboration_id: C }), 0);
  expect("62: ingen samarbeidsprofiler for andre", await count(kristoffer, "collaboration_profiles", { user_id: ids.adrian }), 0);
  expect("62: ingen teamliste", await count(kristoffer, "collaboration_members", { user_id: ids.adrian }), 0);
  await sleep(3000);
  const expired = await fetch(shortLived.data!.signedUrl);
  expect("65: signert lenke virker ikke etter utløp", expired.ok, false);

  expect("13: gamle meldinger er igjen for resten av teamet", await count(adrian, "collaboration_messages", { id: M_k! }), 1);
  expect("13: …også trådsvaret", seen(await adrian.from("collaboration_messages").select("id").eq("parent_message_id", M_q!).eq("author_id", ids.kristoffer)), 1);
  expect("30: historisk forfatter vises fortsatt med samarbeidsprofilen", (await adrian.from("collaboration_profiles").select("display_name").eq("collaboration_id", C).eq("user_id", ids.kristoffer).maybeSingle()).data?.display_name, "Kristoffer i Oslo");
  expect("30: …men er ikke lenger i teamlisten", await count(adrian, "collaboration_members", { user_id: ids.kristoffer }), 0);
  expect("30: dokumentet han opprettet er fortsatt der", await count(adrian, "collaboration_documents", { id: D2! }), 1);
  expect("30: filen han lastet opp er fortsatt der", await canDownload(adrian, "collaboration-files", program.path), true);
  expect("30: kontoen hans er fortsatt lukket for teamet", await count(adrian, "profiles", { id: ids.kristoffer }), 0);

  // 63. A second valid sponsorship keeps access when one goes.
  await rememberMembership(ids.petter, FTR);
  expect("63: (oppsett) Petter flytter selv til FTR Oslo", (await petter.rpc("set_my_local_group", { p_community_id: FTR, p_local_group_id: OSLO })).data, true);
  const S_petter_tu = await sponsorAndJoin(emma, petter, C, P_TU, ids.petter);
  const S_petter_oslo = await rpcId(miaminge, "invite_collaboration_member", { p_collaboration_id: C, p_participant_id: P_OSLO, p_target_user_id: ids.petter });
  expect("63: (oppsett) Petter aksepterer også FTR Oslos sponsing", await rpcOk(petter, "respond_to_collaboration_sponsorship", { p_sponsorship_id: S_petter_oslo, p_accept: true }), true);
  expect("UP: medlem med tilgang, men uten samarbeidsprofil, kan ikke laste opp", (await uploadViaRoute(C_slug, pdfFile, { cookie: await sessionCookie("petter") })).status, 403);
  await persona(petter, C, "Petter P.");
  expect("63: TU trekker sin sponsing", await rpcOk(emma, "revoke_collaboration_sponsorship", { p_sponsorship_id: S_petter_tu }), true);
  expect("63: FTR Oslo-sponsingen holder tilgangen", await rpcOk(petter, "has_collaboration_access", { p_collaboration_id: C }), true);
  expect("63: …og kanalene", await count(petter, "collaboration_channels", { collaboration_id: C }), 5);

  // ══ CROSS-COLLABORATION (66–72) ═════════════════════════════════════

  const C2_TASK = await createTask(octavio, C2, "UTR-intern oppgave", [ids.octavio]);
  const C2_DOC = await rpcId(octavio, "create_collaboration_document", { p_collaboration_id: C2, p_title: "UTR-notat", p_content: "Intern" });
  const C2_EVENT = await rpcId(octavio, "create_collaboration_event", { p_collaboration_id: C2, ...eventArgs({ p_title: "UTR-kveld" }) });
  expect("66: (oppsett) C2 har egne rader", [C2_TASK, C2_DOC, C2_EVENT].every((id) => typeof id === "string"), true);
  expect("66: C-medlem ser ingen C2-kanaler", await count(emma, "collaboration_channels", { collaboration_id: C2 }), 0);
  expect("66: C2-forvalter ser ingen C-kanaler", await count(octavio, "collaboration_channels", { collaboration_id: C }), 0);
  expect("66: C-medlem kan ikke poste i C2-kanal", await rpcId(adrian, "post_collaboration_message", { p_channel_id: C2_GENERAL, p_parent_message_id: null, p_body: "Kryss" }), null);
  expect("67: C-medlem leser ingen C2-meldinger", await count(emma, "collaboration_messages", { collaboration_id: C2 }), 0);
  expect("67: C2-medlem leser ingen C-meldinger", await count(octavio, "collaboration_messages", { id: M_q! }), 0);
  expect("68: C-medlem leser ingen C2-oppgaver", await count(adrian, "collaboration_tasks", { id: C2_TASK! }), 0);
  expect("68: C-medlem kan ikke endre C2-oppgave", await rpcOk(emma, "set_collaboration_task_status", { p_task_id: C2_TASK, p_status: "done" }), false);
  expect("68: oppgave i C kan ikke lenke til C2-dokument", await createTask(ingrid, C, "Kryss", [], { p_related_document_id: C2_DOC }), null);
  expect("68: oppgave i C kan ikke lenke til C2-arrangement", await createTask(ingrid, C, "Kryss", [], { p_related_event_id: C2_EVENT }), null);
  expect("69: C-medlem leser ingen C2-dokumenter", await count(emma, "collaboration_documents", { id: C2_DOC! }), 0);
  expect("69: C-medlem kan ikke lagre C2-dokument", await save(emma, C2_DOC!, 1, "Kapret", "Kapret"), "null|null");
  expect("69: C-medlem leser ingen C2-versjoner", await count(emma, "collaboration_document_versions", { document_id: C2_DOC! }), 0);
  expect("70: C-medlem lister ingen C2-filer", await count(emma, "collaboration_files", { collaboration_id: C2 }), 0);
  expect("70: C2-forvalter laster ikke ned C-filer", await canDownload(octavio, "collaboration-files", plakat.path), false);
  expect("71: C-medlem leser ingen C2-arrangement", await count(emma, "collaboration_events", { id: C2_EVENT! }), 0);
  expect("71: C-forvalter kan ikke redigere C2-arrangement", await rpcOk(emma, "update_collaboration_event", { p_event_id: C2_EVENT, ...eventArgs({ p_title: "Kapret" }) }), false);
  expect("72: C-forvalter kan ikke opprette kanal i C2", await rpcId(emma, "create_collaboration_channel", { p_collaboration_id: C2, p_name: "kapret", p_description: null }), null);
  expect("72: C-forvalter kan ikke publisere C2-arrangement", await rpcId(emma, "publish_collaboration_event", { p_event_id: C2_EVENT, p_image_path: null }), null);
  expect("72: C-forvalter kan ikke arkivere C2-dokument", await rpcOk(emma, "set_collaboration_document_status", { p_document_id: C2_DOC, p_status: "archived" }), false);
  expect("72: C-forvalter kan ikke moderere C2-meldinger", await rpcOk(emma, "delete_collaboration_message", { p_message_id: M_c2 }), false);
  expect("72: C2-forvalter kan ikke arkivere C-kanal", await rpcOk(octavio, "set_collaboration_channel_status", { p_channel_id: PROGRAM, p_status: "archived" }), false);
  expect("72: C2-forvalter kan ikke velge arrangører i C", await rpcOk(octavio, "set_collaboration_event_organizers", { p_event_id: E1, p_participant_ids: [P_UTR] }), false);
  expect("72: Ingrid (i begge, ikke forvalter) kan ikke publisere i noen", `${await rpcId(ingrid, "publish_collaboration_event", { p_event_id: E1, p_image_path: null })}|${await rpcId(ingrid, "publish_collaboration_event", { p_event_id: C2_EVENT, p_image_path: null })}`, "null|null");

  // ══ 64 — the participant unit leaves ════════════════════════════════
  // Last, because it retires Mia's management seat.

  expect("64: (oppsett) FTR Oslo trekker enheten ut", await rpcOk(miaminge, "leave_collaboration_as_participant", { p_participant_id: P_OSLO }), true);
  expect("64: Petter mister tilgangen (siste sponsing gikk via enheten)", await rpcOk(petter, "has_collaboration_access", { p_collaboration_id: C }), false);
  expect("64: …og kanalene", await count(petter, "collaboration_channels", { collaboration_id: C }), 0);
  expect("S: Petter, som aldri skrev noe, blir ikke synlig som «historisk forfatter»", await count(adrian, "collaboration_profiles", { user_id: ids.petter }), 0);
  expect("64: FTR Oslo er arrangør før uttrekket", ((await publicEvent(anon, slug!)).organizers as unknown[]).length, 2);
  expect("64: FTR Oslo er ikke lenger arrangør ved neste oppdatering", `${await rpcId(emma, "publish_collaboration_event", { p_event_id: E1, p_image_path: null })}|${((await publicEvent(anon, slug!)).organizers as unknown[]).length}`, `${slug}|1`);
  expect("PO: en enhet som har trukket seg kan fortsatt trekke tilbake godkjenningen", await consent(miaminge, P_OSLO, false), true);
  expect("PO: …men ikke gi ny", await consent(miaminge, P_OSLO, true), false);
  expect("64: TU-teamet har fortsatt tilgang", await rpcOk(adrian, "has_collaboration_access", { p_collaboration_id: C }), true);

  // ══ CATALOGUE ═══════════════════════════════════════════════════════

  const tableList = WORKSPACE_TABLES.map((t) => `'${t}'`).join(",");
  expect("S: RLS er på for alle nye tabeller", sql(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in (${tableList}) and c.relrowsecurity`), WORKSPACE_TABLES.length);
  expect("S: ingen skriverettigheter for klientroller", sql(`select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in (${tableList}) and grantee in ('anon','authenticated','PUBLIC') and privilege_type <> 'SELECT'`), "0");
  expect("S: anon har ingen tabellrettigheter", sql(`select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in (${tableList}) and grantee in ('anon','PUBLIC')`), "0");
  expect("S: ingen skrivepolicyer", sql(`select count(*) from pg_policies where schemaname = 'public' and tablename in (${tableList}) and cmd <> 'SELECT'`), "0");
  for (const table of WORKSPACE_TABLES) {
    const { data, error } = await anon.from(table as never).select("*");
    expect(`S: anonym kan ikke lese ${table}`, error !== null || ((data as unknown[]) ?? []).length === 0, true);
    const insert = await (adrian as unknown as Loose).from(table).insert({});
    expect(`S: medlem kan ikke INSERT i ${table}`, insert.error !== null, true);
  }

  const newFunctions = [
    "manages_collaboration_workspace", "can_view_collaboration_author", "collaboration_can_contribute",
    "collaboration_user_contributed", "collaboration_create_default_channel", "collaboration_message_thread_depth",
    "create_collaboration_channel", "update_collaboration_channel", "set_collaboration_channel_status",
    "post_collaboration_message", "edit_collaboration_message", "delete_collaboration_message",
    "create_collaboration_document", "save_collaboration_document", "set_collaboration_document_status",
    "collaboration_assignees_valid", "collaboration_task_links_valid", "create_collaboration_task",
    "update_collaboration_task", "set_collaboration_task_status", "set_collaboration_task_assignees",
    "collaboration_file_object_collaboration", "can_read_collaboration_file_object",
    "can_upload_collaboration_file_object", "can_discard_collaboration_file_object",
    "register_collaboration_file", "remove_collaboration_file", "collaboration_event_fields_valid",
    "create_collaboration_event", "update_collaboration_event", "set_collaboration_event_organizers",
    "set_collaboration_event_image", "published_event_image_is_public", "can_upload_published_event_image",
    "set_collaboration_event_organizer_consent", "collaboration_organizer_request",
    "publish_collaboration_event", "unpublish_collaboration_event", "published_event_by_slug",
  ];
  const fnList = newFunctions.map((f) => `'${f}'`).join(",");
  const fn = `from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (${fnList})`;
  expect("S: alle nye funksjoner finnes", sql(`select count(*) ${fn}`), newFunctions.length);
  expect("S: alle er SECURITY DEFINER", sql(`select count(*) ${fn} and not p.prosecdef`), "0");
  expect("S: alle har låst search_path", sql(`select count(*) ${fn} and not coalesce('search_path=public' = any(p.proconfig), false)`), "0");
  expect("S: PUBLIC kan ikke kjøre noen", sql(`select count(*) ${fn} and has_function_privilege('public', p.oid, 'execute')`), "0");
  expect(
    "S: anon kan kjøre nøyaktig de to offentlige funksjonene",
    sql(`select string_agg(p.proname, ',' order by p.proname) ${fn} and has_function_privilege('anon', p.oid, 'execute')`),
    "published_event_by_slug,published_event_image_is_public",
  );
  const internal = ["collaboration_can_contribute", "collaboration_user_contributed", "collaboration_assignees_valid", "collaboration_task_links_valid", "collaboration_file_object_collaboration", "collaboration_event_fields_valid", "collaboration_create_default_channel", "collaboration_message_thread_depth"];
  expect("S: interne hjelpere er ikke kjørbare for authenticated", sql(`select count(*) ${fn} and p.proname in (${internal.map((f) => `'${f}'`).join(",")}) and has_function_privilege('authenticated', p.oid, 'execute')`), "0");
  const oracle = await rpc(octavio, "collaboration_user_contributed", { p_collaboration_id: C, p_user_id: ids.kristoffer });
  expect("S: bidrags-orakel kan ikke kalles", oracle.error !== null, true);
  expect("S: forfatter-sjekken svarer nei utenfra", (await rpc(octavio, "can_view_collaboration_author", { p_collaboration_id: C, p_user_id: ids.kristoffer })).data, false);
  expect("S: ingen ny mengdereturnerende funksjon", sql(`select count(*) ${fn} and p.proretset`), "0");
  expect(
    "S: den offentlige funksjonen tar én slug og returnerer én rad",
    sql("select p.pronargs::text || '|' || p.proretset::text from pg_proc p where p.oid = 'public.published_event_by_slug(text)'::regprocedure"),
    "1|false",
  );
  // Same reviewed exceptions as R3 in check:collaborations: the two functions
  // that archive a private lokallag channel and a community group. Neither
  // takes or touches a collaboration.
  expect("S: ingen «archive»-funksjon (R3 gjelder fortsatt)", sql("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ilike '%archive%' and p.proname not in ('set_private_channel_archived','set_subgroup_archived')"), "0");
  expect("S: publiseringsbøtta er privat", sql("select public::text from storage.buckets where id = 'published-event-images'"), "false");

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} arbeidsrom-kontroller feilet.\n`);
    return;
  }
  console.log(`✓ ${checks} arbeidsrom-kontroller passerte`);
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(async () => {
    await restore();
    if (failures > 0) process.exit(1);
  });
