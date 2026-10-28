/**
 * Members write only the columns TING's own forms write
 * (supabase/migrations/20261114100000_member_write_columns.sql).
 *
 * The injection audit of 2026-10-28 found that a member calling the Data API
 * directly could store a channel message with a made-up `attachment` (one
 * whose shape broke the channel page for everyone), invented `reactions`,
 * any `created_at`, and a body of any size; a backdated comment; and, as a
 * moderator, a post with invented counts. This suite tries each of those as
 * the real caller and expects the database to refuse.
 *
 * Every attempt here is one the database must refuse, so the suite writes
 * nothing. Should one get through (a regression), the rows it made carry
 * TAG and are removed again at the end.
 *
 * Run with `npm run check:message-integrity` against the local stack after
 * `npm run seed`.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";
import { MESSAGE_BODY_MAX, legacyMessageAttachment } from "@/lib/message-form";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

const FTR = "tryggere-ruspolitikk";
const GENERAL = `${FTR}--generelt`;
const NEVER = "00000000-0000-0000-0000-000000000000";
const TAG = `[sjekk-meldingsintegritet ${Date.now()}]`;
const DENIED = "42501";
const CHECK_VIOLATION = "23514";

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

type Client = SupabaseClient<Database>;
/** Untyped, so a probe can send columns the generated types would refuse. */
type Loose = SupabaseClient;
const loose = (client: Client) => client as unknown as Loose;

function code(result: { error: { code?: string } | null }): string {
  return result.error ? (result.error.code ?? "error") : "ok";
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
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
  if (verifyError) throw verifyError;
  return client;
}

// ── The shape the channel page renders ────────────────────────────────────

function checkLegacyAttachmentShape() {
  const good = { kind: "file", label: "Vedtak.pdf", meta: "PDF · 2 MB" };
  expect("form: et gyldig vedleggskort beholdes", JSON.stringify(legacyMessageAttachment(good)), JSON.stringify(good));
  expect(
    "form: ekstra felter tas ikke med",
    JSON.stringify(legacyMessageAttachment({ ...good, href: "javascript:alert(1)" })),
    JSON.stringify(good),
  );
  const refused: [string, unknown][] = [
    ["et objekt som label", { kind: "file", label: { x: 1 }, meta: "x" }],
    ["en liste som meta", { kind: "link", label: "x", meta: ["x"] }],
    ["tom label", { kind: "file", label: "", meta: "x" }],
    ["ukjent kind", { kind: "script", label: "x", meta: "x" }],
    ["en liste", [good]],
    ["tekst", "Vedtak.pdf"],
    ["null", null],
  ];
  for (const [label, value] of refused) {
    expect(`form: ${label} blir ikke et vedleggskort`, legacyMessageAttachment(value), undefined);
  }
}

// ── Channel messages, as an ordinary member ───────────────────────────────

async function checkMessages(linn: Client, linnId: string) {
  const body = (note: string) => `${TAG} ${note}`;
  const forged: [string, Record<string, unknown>][] = [
    ["et eget tidspunkt", { created_at: "2020-01-01T00:00:00Z" }],
    ["egne reaksjonstall", { reactions: [{ emoji: "👍", count: 9999 }] }],
    ["et vedleggskort som knekker siden", { attachment: { kind: "file", label: { x: 1 }, meta: "x" } }],
    ["et vedleggskort i riktig form", { attachment: { kind: "file", label: "Vedtak.pdf", meta: "PDF · 2 MB" } }],
    ["en egen id", { id: crypto.randomUUID() }],
    ["seg selv som forfatter, uttrykkelig", { author_id: linnId }],
    ["som redigert", { edited_at: new Date().toISOString() }],
    ["som slettet av moderator", { deleted_at: new Date().toISOString(), removed_by_moderator: true }],
  ];
  for (const [label, extra] of forged) {
    const result = await loose(linn).from("messages").insert({ channel_id: GENERAL, body: body(label), ...extra });
    expect(`linn: melding med ${label} nektes`, code(result), DENIED);
  }

  const tooLong = await linn.from("messages").insert({ channel_id: GENERAL, body: "A".repeat(MESSAGE_BODY_MAX + 1) });
  expect("linn: melding over 4000 tegn nektes av databasen", code(tooLong), CHECK_VIOLATION);
  expect("linn: … av messages_body_length", /messages_body_length/.test(tooLong.error?.message ?? ""), true);

  // Not even the server's key gets a shape the page cannot render past the table.
  const badShape = await admin
    .from("messages")
    .insert({ channel_id: GENERAL, author_id: linnId, body: body("server"), attachment: { kind: "file", label: { x: 1 }, meta: "x" } });
  expect("server: vedleggskort i feil form nektes", code(badShape), CHECK_VIOLATION);
  expect("server: … av messages_attachment_shape", /messages_attachment_shape/.test(badShape.error?.message ?? ""), true);
}

// ── Comments, posts and events ────────────────────────────────────────────

async function checkComments(linn: Client) {
  const { data: post } = await linn.from("posts").select("id").eq("community_id", FTR).limit(1).maybeSingle();
  if (!post) throw new Error("linn ser ingen innlegg i FTR – er databasen seedet?");

  const forged: [string, Record<string, unknown>][] = [
    ["et eget tidspunkt", { created_at: "2019-01-01T00:00:00Z" }],
    ["som redigert", { edited_at: new Date().toISOString() }],
    ["en egen id", { id: crypto.randomUUID() }],
  ];
  for (const [label, extra] of forged) {
    const result = await loose(linn).from("comments").insert({ post_id: post.id, body: `${TAG} ${label}`, ...extra });
    expect(`linn: kommentar med ${label} nektes`, code(result), DENIED);
  }
  // Column privileges are checked before any row is looked at, so an id that
  // matches nothing still answers for the columns named.
  for (const column of ["created_at", "author_id", "post_id", "parent_id"]) {
    const value = column === "created_at" ? "2019-01-01T00:00:00Z" : NEVER;
    const result = await loose(linn).from("comments").update({ [column]: value }).eq("id", NEVER);
    expect(`linn: kan ikke endre kommentarens ${column}`, code(result), DENIED);
  }
}

async function checkPosts(kari: Client) {
  const forged: [string, Record<string, unknown>][] = [
    ["egne reaksjonstall", { reactions: [{ emoji: "❤️", count: 5000 }] }],
    ["eget kommentartall", { comment_count: 777 }],
    ["et tidspunkt i fremtiden", { created_at: "2030-01-01T00:00:00Z" }],
    ["festet fra start", { pinned: true }],
    ["en annen forfatter", { author_id: NEVER }],
  ];
  for (const [label, extra] of forged) {
    const result = await loose(kari).from("posts").insert({ community_id: FTR, title: TAG, body: `${TAG} ${label}`, ...extra });
    expect(`kari (moderator): innlegg med ${label} nektes`, code(result), DENIED);
  }
  for (const [column, value] of [["pinned", true], ["comment_count", 1], ["reactions", []], ["community_id", FTR]] as const) {
    const result = await loose(kari).from("posts").update({ [column]: value }).eq("id", NEVER);
    expect(`kari (moderator): kan ikke endre innleggets ${column} direkte`, code(result), DENIED);
  }
}

async function checkEvents(mia: Client) {
  const base = {
    community_id: FTR,
    title: TAG,
    description: "",
    location: "x",
    starts_at: new Date(Date.now() + 9e8).toISOString(),
    ends_at: new Date(Date.now() + 9.1e8).toISOString(),
  };
  const forged: [string, Record<string, unknown>][] = [
    ["som avlyst", { cancelled_at: new Date().toISOString() }],
    ["en annen vert", { host_id: NEVER }],
    ["en egen id", { id: crypto.randomUUID() }],
  ];
  for (const [label, extra] of forged) {
    const result = await loose(mia).from("events").insert({ ...base, ...extra });
    expect(`mia (admin): arrangement med ${label} nektes`, code(result), DENIED);
  }
  for (const [column, value] of [["is_public", true], ["host_id", NEVER], ["cancelled_at", new Date().toISOString()], ["subgroup_id", null]] as const) {
    const result = await loose(mia).from("events").update({ [column]: value }).eq("id", NEVER);
    expect(`mia (admin): kan ikke endre arrangementets ${column} direkte`, code(result), DENIED);
  }
}

/** Anything a regression let through, so a failing run leaves nothing behind. */
async function cleanup() {
  await admin.from("messages").delete().like("body", `${TAG}%`);
  await admin.from("comments").delete().like("body", `${TAG}%`);
  await admin.from("posts").delete().eq("title", TAG);
  await admin.from("events").delete().eq("title", TAG);
}

async function main() {
  checkLegacyAttachmentShape();
  const [linn, kari, mia] = await Promise.all([signIn("linn"), signIn("karimoen"), signIn("miaminge")]);
  try {
    await checkMessages(linn, await profileId("linn"));
    await checkComments(linn);
    await checkPosts(kari);
    await checkEvents(mia);
  } finally {
    await cleanup();
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} integritetskontroller feilet.\n`);
    return;
  }
  console.log(`✓ ${checks} integritetskontroller passerte`);
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(() => {
    if (failures > 0) process.exit(1);
  });
