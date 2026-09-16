/**
 * Checks what a person may do to a notification.
 *
 * The table has carried a recipient-only SELECT policy and a recipient-only
 * UPDATE policy since the first migration, and those are correct as far as
 * they go: nobody reads anyone else's notifications and nobody writes to them.
 * What the UPDATE policy never said is *which columns*. A policy admits or
 * refuses a whole row, so `with check (user_id = auth.uid())` was satisfied by
 * any edit that left the row belonging to the same person — including one that
 * rewrote its title, body, link and kind. That was verified against this
 * database before 20260916160000: a single request rewrote all four on six
 * rows at once.
 *
 * `varselet kan ikke få ny tittel` and its neighbours below are the regression
 * tests for that, and they fail against the pre-hardening database.
 *
 * Two layers now stand behind those checks — a column privilege that stops the
 * request being made, and a trigger that stops the write being applied. A
 * behavioural test cannot tell which one refused, and that is the point: it
 * asserts the invariant rather than the mechanism, so either layer alone keeps
 * it passing and removing both is what breaks it.
 *
 * Every case runs as a real signed-in caller — a session minted with
 * `admin.generateLink` and redeemed with `verifyOtp`, then writes through
 * PostgREST under row level security, exactly as the application does. A check
 * that used the service role would bypass the very rules it claims to test;
 * the service role appears only where the seed's own path is what is under
 * test.
 *
 * Whatever it creates it removes again, and every row it touches is put back.
 *
 * Run with `npm run check:notifications` against the local stack.
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { internalHref } from "@/lib/notification-href";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties) {
    throw new Error(`kunne ikke lage lenke for ${email}: ${error?.message}`);
  }
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw new Error(`kunne ikke logge inn som ${email}: ${verifyError.message}`);
  return client;
}

function anonymous(): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl(), supabaseAnonKey());
}

async function profileId(handle: string): Promise<string> {
  const { data } = await admin.from("profiles").select("id").eq("handle", handle).single();
  return data!.id;
}

async function emailFor(handle: string): Promise<string> {
  const { data: user } = await admin.auth.admin.getUserById(await profileId(handle));
  return user.user!.email!;
}

/** One notification row as the database actually holds it — service role, no RLS. */
async function stored(id: string) {
  const { data } = await admin.from("notifications").select("*").eq("id", id).single();
  return data!;
}

async function firstNotificationOf(handle: string): Promise<string> {
  const { data } = await admin
    .from("notifications")
    .select("id")
    .eq("user_id", await profileId(handle))
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data!.id;
}

async function unreadCount(handle: string): Promise<number> {
  const { count } = await admin
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", await profileId(handle))
    .eq("read", false);
  return count ?? 0;
}

async function main() {
  // Roles used below, from the seed:
  //   ingrid — 6 notifications, 3 unread
  //   jonas  — 3 notifications, 2 unread. Shares no notification with Ingrid.
  //   oskar  — an account with a pending access request to Tryggere
  //   amina  — administrator of Tryggere, so she can approve that request
  const [ingrid, jonas] = await Promise.all([
    signIn(await emailFor("ingrid")),
    signIn(await emailFor("jonas")),
  ]);
  const anon = anonymous();

  const ingridId = await profileId("ingrid");
  const jonasId = await profileId("jonas");
  const target = await firstNotificationOf("ingrid");
  const jonasNotification = await firstNotificationOf("jonas");
  const before = await stored(target);

  // The seeded read/unread mix, so it can be put back exactly as found.
  const readStateBefore = (await admin.from("notifications").select("id, read")).data!;

  // Jonas is the control throughout: nothing Ingrid does may move this number.
  const jonasUnreadBaseline = await unreadCount("jonas");

  // ── A. Reading ────────────────────────────────────────────────────────
  const mine = await ingrid.from("notifications").select("id");
  expect("mottakeren ser sine egne varsler", (mine.data ?? []).length, 6);

  const theirs = await ingrid.from("notifications").select("id").eq("user_id", jonasId);
  expect("mottakeren ser ikke andres varsler", (theirs.data ?? []).length, 0);

  const anonRead = await anon.from("notifications").select("id");
  expect("utlogget ser ingen varsler", (anonRead.data ?? []).length, 0);

  // ── B. Creating ───────────────────────────────────────────────────────
  //
  // There is no INSERT policy at all, so every one of these is refused before
  // the question of *whose* notification it is arises.
  const selfInsert = await ingrid
    .from("notifications")
    .insert({ user_id: ingridId, kind: "announcement", title: "Forfalsket", body: "x", href: "/" })
    .select("id");
  expect("kan ikke lage varsel til seg selv", selfInsert.error !== null, true);

  const otherInsert = await ingrid
    .from("notifications")
    .insert({ user_id: jonasId, kind: "announcement", title: "Forfalsket", body: "x", href: "/" })
    .select("id");
  expect("kan ikke lage varsel til andre", otherInsert.error !== null, true);

  const anonInsert = await anon
    .from("notifications")
    .insert({ user_id: ingridId, kind: "announcement", title: "Forfalsket", body: "x", href: "/" })
    .select("id");
  expect("utlogget kan ikke lage varsel", anonInsert.error !== null, true);

  const { count: afterInserts } = await admin
    .from("notifications")
    .select("*", { count: "exact", head: true });
  expect("ingen nye rader ble laget", afterInserts, 10);

  // ── C. The read state, and only the read state ────────────────────────
  const flip = await ingrid
    .from("notifications")
    .update({ read: !before.read })
    .eq("id", target)
    .select("id");
  expect("mottakeren kan endre lest-status", (flip.data ?? []).length, 1);
  expect("og den ble lagret", (await stored(target)).read, !before.read);

  await ingrid.from("notifications").update({ read: before.read }).eq("id", target);
  expect("satt tilbake", (await stored(target)).read, before.read);

  // Each column on its own, so a failure names the one that moved.
  const immutable: [string, Record<string, unknown>, keyof typeof before][] = [
    ["ny tittel", { title: "Forfalsket tittel" }, "title"],
    ["ny brødtekst", { body: "Forfalsket tekst" }, "body"],
    ["ny lenke", { href: "/et-helt-annet-sted" }, "href"],
    ["ny type", { kind: "invitation" }, "kind"],
    ["nytt fellesskap", { community_id: "under-the-rug" }, "community_id"],
    ["ny mottaker", { user_id: jonasId }, "user_id"],
    ["nytt tidspunkt", { created_at: "2020-01-01T00:00:00Z" }, "created_at"],
    ["ny id", { id: "00000000-0000-0000-0000-000000000000" }, "id"],
  ];

  for (const [what, patch, column] of immutable) {
    const attempt = await ingrid
      .from("notifications")
      .update(patch as never)
      .eq("id", target)
      .select("id");
    const changed = (attempt.data ?? []).length > 0;
    expect(`varselet kan ikke få ${what}`, changed, false);
    expect(`varselet beholdt ${String(column)}`, (await stored(target))[column], before[column]);
  }

  // The whole row, untouched, after all of that.
  expect(
    "hele raden står som før",
    JSON.stringify(await stored(target)),
    JSON.stringify(before),
  );

  // A legitimate read-state change still works afterwards — the hardening
  // narrowed the write, it did not remove it.
  const stillWorks = await ingrid
    .from("notifications")
    .update({ read: !before.read })
    .eq("id", target)
    .select("id");
  expect("lest-status virker fortsatt etterpå", (stillWorks.data ?? []).length, 1);
  await ingrid.from("notifications").update({ read: before.read }).eq("id", target);

  // ── D. Someone else's row ─────────────────────────────────────────────
  const jonasBefore = await stored(jonasNotification);
  const crossUpdate = await ingrid
    .from("notifications")
    .update({ read: !jonasBefore.read })
    .eq("id", jonasNotification)
    .select("id");
  expect("kan ikke endre andres varsel", (crossUpdate.data ?? []).length, 0);
  expect("andres varsel står urørt", (await stored(jonasNotification)).read, jonasBefore.read);

  const anonUpdate = await anon
    .from("notifications")
    .update({ read: true })
    .eq("id", target)
    .select("id");
  expect("utlogget kan ikke endre varsler", (anonUpdate.data ?? []).length, 0);

  // ── E. Removing ───────────────────────────────────────────────────────
  //
  // No DELETE policy exists, and this migration deliberately did not add one.
  const selfDelete = await ingrid.from("notifications").delete().eq("id", target).select("id");
  expect("kan ikke slette eget varsel", (selfDelete.data ?? []).length, 0);

  const anonDelete = await anon.from("notifications").delete().eq("id", target).select("id");
  expect("utlogget kan ikke slette varsel", (anonDelete.data ?? []).length, 0);

  const { count: afterDeletes } = await admin
    .from("notifications")
    .select("*", { count: "exact", head: true });
  expect("alle ti rader er fortsatt der", afterDeletes, 10);

  // ── I. Marking one notification read ──────────────────────────────────
  //
  // The write the notification list performs when a row is clicked. It is a
  // plain update rather than an RPC, so what confines it is the same pair the
  // rest of this file tests: the policy picks the row, the column grant picks
  // the column. These cases are that claim, from a real session.
  const ingridUnread = (
    await admin
      .from("notifications")
      .select("id, read, title")
      .eq("user_id", ingridId)
      .eq("read", false)
      .order("created_at", { ascending: false })
  ).data!;
  expect("ingrid har flere uleste å skille mellom", ingridUnread.length >= 2, true);

  const [toMark, shouldStayUnread] = ingridUnread;
  const toMarkBefore = await stored(toMark.id);

  const marking = await ingrid
    .from("notifications")
    .update({ read: true })
    .eq("id", toMark.id)
    .select("id");
  expect("ett varsel kan merkes som lest", (marking.data ?? []).length, 1);
  expect("og det ble lagret", (await stored(toMark.id)).read, true);

  // Exactly one moved — the whole point of this being per-row.
  expect(
    "nabovarselet er fortsatt ulest",
    (await stored(shouldStayUnread.id)).read,
    false,
  );
  expect("ingrid har nøyaktig ett færre ulest", await unreadCount("ingrid"), ingridUnread.length - 1);
  expect("jonas er urørt", await unreadCount("jonas"), jonasUnreadBaseline);

  // Marking read is not editing: everything else about the row stands.
  const markedRow = await stored(toMark.id);
  for (const column of ["id", "user_id", "kind", "community_id", "title", "body", "href", "created_at"] as const) {
    expect(`å lese endret ikke ${column}`, markedRow[column], toMarkBefore[column]);
  }

  // Doing it again is a no-op rather than an error.
  const again = await ingrid
    .from("notifications")
    .update({ read: true })
    .eq("id", toMark.id)
    .select("id");
  expect("å merke som lest på nytt er greit", (again.data ?? []).length, 1);
  expect("og lest-status står", (await stored(toMark.id)).read, true);
  expect("uleste-tallet flyttet seg ikke", await unreadCount("ingrid"), ingridUnread.length - 1);

  // Someone else's id, supplied directly. The policy matches no row, so this
  // is indistinguishable from an id that does not exist.
  const jonasUnreadRow = (
    await admin
      .from("notifications")
      .select("id")
      .eq("user_id", jonasId)
      .eq("read", false)
      .limit(1)
      .single()
  ).data!;
  const crossMark = await ingrid
    .from("notifications")
    .update({ read: true })
    .eq("id", jonasUnreadRow.id)
    .select("id");
  expect("kan ikke merke andres varsel som lest", (crossMark.data ?? []).length, 0);
  expect("andres varsel er fortsatt ulest", (await stored(jonasUnreadRow.id)).read, false);
  expect("og jonas har like mange uleste", await unreadCount("jonas"), jonasUnreadBaseline);

  const madeUpId = await ingrid
    .from("notifications")
    .update({ read: true })
    .eq("id", "00000000-0000-0000-0000-000000000000")
    .select("id");
  expect("oppdiktet id gjør ingenting", (madeUpId.data ?? []).length, 0);
  expect("og feiler stille, som andres id", (madeUpId.data ?? []).length, (crossMark.data ?? []).length);

  const anonSingleMark = await anon
    .from("notifications")
    .update({ read: true })
    .eq("id", shouldStayUnread.id)
    .select("id");
  expect("utlogget kan ikke merke som lest", (anonSingleMark.data ?? []).length, 0);
  expect("og varselet er fortsatt ulest", (await stored(shouldStayUnread.id)).read, false);

  // Put this section's one change back before the mark-all cases run.
  await admin.from("notifications").update({ read: toMarkBefore.read }).eq("id", toMark.id);

  // ── F & G. mark_notifications_read() ──────────────────────────────────
  const ingridUnreadBefore = await unreadCount("ingrid");
  const jonasUnreadBefore = await unreadCount("jonas");
  expect("utgangspunkt: ingrid har uleste", ingridUnreadBefore > 0, true);
  expect("utgangspunkt: jonas har uleste", jonasUnreadBefore > 0, true);

  const marked = await ingrid.rpc("mark_notifications_read");
  expect("funksjonen kan kalles av en innlogget bruker", marked.error, null);
  expect("kallerens uleste ble lest", await unreadCount("ingrid"), 0);
  expect("andres uleste står urørt", await unreadCount("jonas"), jonasUnreadBefore);

  // It marks read; it does not touch anything else.
  const afterMark = await stored(target);
  expect("funksjonen endret ikke tittelen", afterMark.title, before.title);
  expect("funksjonen endret ikke mottakeren", afterMark.user_id, before.user_id);
  expect("funksjonen endret ikke lenken", afterMark.href, before.href);

  const anonMark = await anon.rpc("mark_notifications_read");
  expect("utlogget kan ikke kalle funksjonen", anonMark.error !== null, true);
  expect("og jonas er fortsatt ulest", await unreadCount("jonas"), jonasUnreadBefore);

  // Jonas marking his own must not reach back into Ingrid's, either.
  await jonas.rpc("mark_notifications_read");
  expect("jonas leser bare sine egne", await unreadCount("jonas"), 0);

  // Put the seeded read state back, row by row. Not a blanket false: the seed
  // deliberately leaves some notifications read and some unread, and flattening
  // that would leave the database looking restored while it was not.
  for (const row of readStateBefore) {
    await admin.from("notifications").update({ read: row.read }).eq("id", row.id);
  }

  // ── H. The service role can still maintain this table ─────────────────
  //
  // The seed writes these rows, and a maintenance script has to be able to
  // correct one. The trigger exempts the service role for that reason; if that
  // exemption were dropped, the failure would be silent — a refused PostgREST
  // write returns an error object rather than throwing.
  const maintenance = await admin
    .from("notifications")
    .update({ title: "Vedlikehold" })
    .eq("id", target)
    .select("id");
  expect("tjenesterollen kan rette innholdet", maintenance.error, null);
  expect("og endringen slo gjennom", (await stored(target)).title, "Vedlikehold");
  await admin.from("notifications").update({ title: before.title }).eq("id", target);
  expect("satt tilbake", (await stored(target)).title, before.title);

  const created = await admin
    .from("notifications")
    .insert({
      user_id: ingridId,
      kind: "announcement",
      community_id: "tryggere-ruspolitikk",
      title: "Sjekk: opprettet av tjenesterollen",
      body: "Slettes igjen.",
      href: "/",
    })
    .select("id")
    .single();
  expect("tjenesterollen kan opprette varsler (seed-veien)", created.error, null);
  await admin.from("notifications").delete().eq("id", created.data!.id);

  // ── The one real generator ────────────────────────────────────────────
  //
  // accept_invitation_token() is currently the only thing in the product that
  // creates a notification. It inserts rather than updates, and runs as the
  // table owner, so neither new layer should be able to reach it — but that is
  // an argument, and this is the test.
  const { data: request } = await admin
    .from("access_requests")
    .select("id, community_id, email, status, reviewed_at, reviewed_by")
    .eq("email", "oskar@lie.studio")
    .single();

  const amina = await signIn(await emailFor("amina"));
  const approval = await amina.rpc("approve_access_request", { p_request_id: request!.id });
  const invitationToken = (approval.data as { token: string }[] | null)?.[0]?.token;
  expect("administrator kunne godkjenne forespørselen", Boolean(invitationToken), true);

  const oskarId = await profileId("oskar");
  const oskarNotificationsBefore = (
    await admin.from("notifications").select("id").eq("user_id", oskarId)
  ).data!.length;

  const oskar = await signIn(await emailFor("oskar"));
  const redeemed = await oskar.rpc("accept_invitation_token", { p_token: invitationToken! });
  const outcome = (redeemed.data as { ok: boolean; reason: string }[] | null)?.[0];
  expect("invitasjonen kunne løses inn", outcome?.ok, true);
  expect("og den ga medlemskap", outcome?.reason, "joined");

  const { data: oskarNow } = await admin
    .from("notifications")
    .select("id, kind, community_id, title")
    .eq("user_id", oskarId);
  expect(
    "innløsningen lagde fortsatt et varsel",
    oskarNow!.length,
    oskarNotificationsBefore + 1,
  );
  const fresh = oskarNow!.find((n) => n.title.startsWith("Du er nå medlem"));
  expect("varselet er av riktig type", fresh?.kind, "membership");
  expect("og hører til riktig fellesskap", fresh?.community_id, request!.community_id);

  // Undo the whole invitation flow, in reverse.
  await admin.from("notifications").delete().eq("id", fresh!.id);
  await admin
    .from("memberships")
    .delete()
    .eq("user_id", oskarId)
    .eq("community_id", request!.community_id);
  await admin.from("invitations").delete().eq("request_id", request!.id);
  await admin
    .from("access_requests")
    .update({
      status: request!.status,
      reviewed_at: request!.reviewed_at,
      reviewed_by: request!.reviewed_by,
    })
    .eq("id", request!.id);

  // ── J. The application actually takes these paths ─────────────────────
  //
  // Everything above proves the database answers correctly when asked. This is
  // what proves the product asks. Without it, replacing the per-row click with
  // a call to mark_notifications_read() — marking the whole list read because
  // one row was opened — would leave every check above passing.
  const dataSource = readFileSync("lib/data.ts", "utf8");
  // The function body alone. Slicing to the *next declaration* would swallow
  // markAllNotificationsRead's doc comment, which mentions the RPC by name and
  // would make the "does not go via mark-all" check below pass for the wrong
  // reason — or, as it first did, fail for one.
  const singleStart = dataSource.indexOf("export async function markNotificationRead(");
  const single = dataSource.slice(singleStart, dataSource.indexOf("\n}", singleStart));
  expect("markNotificationRead skriver bare lest-status", /\.update\(\{\s*read:\s*true\s*\}\)/.test(single), true);
  expect("markNotificationRead peker på én rad", /\.eq\("id",\s*notificationId\)/.test(single), true);
  expect(
    "markNotificationRead går ikke via merk-alle",
    single.includes("mark_notifications_read"),
    false,
  );

  const pageSource = readFileSync("app/(app)/notifications/page.tsx", "utf8");
  expect("listen bruker raden som merker som lest", pageSource.includes("<NotificationRow"), true);
  expect("og lenken går gjennom href-vakten", pageSource.includes("internalHref(notification.href)"), true);
  expect(
    "merk-alle vises bare når noe er ulest",
    /action=\{unread > 0 \? <MarkAllReadButton \/> : undefined\}/.test(pageSource),
    true,
  );
  expect(
    "den gamle tomteksten lover ikke lenger funksjoner vi ikke har",
    pageSource.includes("når noen nevner deg"),
    false,
  );

  // The href guard, on the values actually stored.
  const { data: allHrefs } = await admin.from("notifications").select("href");
  const external = (allHrefs ?? []).filter((row) => internalHref(row.href) === null);
  expect("alle seedede lenker er interne stier", external.length, 0);
  for (const [raw, why] of [
    ["//evil.example/x", "protokoll-relativ"],
    ["https://evil.example/x", "annet opphav"],
    ["javascript:alert(1)", "skript"],
    ["community/feed", "relativ"],
  ] as const) {
    expect(`href-vakten avviser ${why}`, internalHref(raw), null);
  }
  expect("men slipper gjennom en vanlig sti", internalHref("/community/x/feed"), "/community/x/feed");

  // ── Back to where we started ──────────────────────────────────────────
  const { count: finalCount } = await admin
    .from("notifications")
    .select("*", { count: "exact", head: true });
  expect("ti varsler, som i seed", finalCount, 10);

  const { count: finalUnread } = await admin
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("read", false);
  expect("og seks av dem er uleste", finalUnread, 6);

  const { count: memberships } = await admin
    .from("memberships")
    .select("*", { count: "exact", head: true });
  expect("medlemskapene er tilbake til 24", memberships, 24);

  const { count: invitations } = await admin
    .from("invitations")
    .select("*", { count: "exact", head: true });
  expect("ingen invitasjon ble liggende igjen", invitations, 0);

  const { count: pending } = await admin
    .from("access_requests")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");
  expect("begge forespørslene venter igjen", pending, 2);

  expect("og målraden er uendret", JSON.stringify(await stored(target)), JSON.stringify(before));

  if (failures > 0) {
    console.error(`\n${failures} av ${checks} kontroller feilet.`);
    process.exit(1);
  }
  console.log(`✓ ${checks} kontroller passerte`);
  console.log("  et varsel kan bare markeres som lest — alt annet er låst");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
