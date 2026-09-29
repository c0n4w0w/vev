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
 * Since 20260916180000 the file also covers the other direction: who a
 * notification is *created* for. Publishing a feed announcement fans out to
 * every active member of that community except its author, and section K
 * exercises that through the ordinary publish path — there is no callable
 * generator to invoke, because the fan-out is an AFTER INSERT trigger. Those
 * cases fail if the trigger is dropped, if the author exclusion is removed, or
 * if the recipient query stops being scoped to the announcement's own
 * community.
 *
 * Section L does the same for the access request lifecycle added in
 * 20260916200000 and reshaped by 20260923150000: a new request notifies the
 * community's administrators and nobody else — not its moderators, who
 * cannot open the queue — and a rejection notifies the applicant when the
 * address belongs to an account. Approval notifies conditionally on what it
 * does: silently mints a claim-link invitation for an address with no usable
 * account (still asserted as producing no notice), but notifies immediately
 * when the address already has a confirmed account and approval activates
 * membership on the spot — the same "Du er nå medlem" notice redemption
 * writes, just reached by a shorter path. Those cases fail if request
 * generation is removed, if the recipient query stops being scoped to the
 * requested community, if the rejection notice goes missing or goes to the
 * wrong person, if an already-confirmed account stops being activated
 * directly, or if either activation path's notice goes missing, duplicates on
 * a retry, or is sent for the wrong path.
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
import { notifications as fixtureNotifications } from "@/lib/mock/notifications";
import { demoPersonas } from "@/lib/mock/demo-personas";
import { users } from "@/lib/mock/users";
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
  // For an address with no account yet, GoTrue mints a signup token rather
  // than a magiclink one even though `magiclink` is what was asked for —
  // `verification_type` says which it actually is, and verifying with the
  // wrong one fails as "expired" regardless of how fresh the link is. This is
  // what lets this same helper simulate both "log in" for an existing seeded
  // persona and "create an account by logging in" for a brand new address.
  const { error: verifyError } = await client.auth.verifyOtp({
    type: data.properties.verification_type as "signup" | "magiclink",
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

const TR = "tryggere-ruspolitikk";
const UTR = "under-the-rug";

/**
 * Fixture account id → the handle it is seeded under.
 *
 * For most people the two are the same string. The showcase personas are the
 * exception: `demo-tryggere` is seeded as `karimoen`, because their fixture ids
 * name the showcase and their handles name the person.
 */
const handleForFixtureUser = new Map(
  [...users, ...demoPersonas].map((person) => [person.id, person.handle]),
);
const asHandle = (fixtureUserId: string) =>
  handleForFixtureUser.get(fixtureUserId) ?? fixtureUserId;

async function main() {
  // Roles used below, from the seed. Counts come from the fixture file rather
  // than this comment, which is what keeps them from going stale.
  //   ingrid — moderator in Tryggere/FTR and TU, member in UTR
  //   jonas  — ordinary member of UTR, and the control for recipient isolation
  //   oskar  — an account with a pending access request to Tryggere
  //   lars   — administrator of Tryggere, so he can approve that request
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

  // Every notification that existed before this run. The announcement section
  // creates real ones through the real publish path, and this is how they are
  // told apart from the seed afterwards — by identity, not by matching titles.
  const seededNotificationIds = (await admin.from("notifications").select("id")).data!.map(
    (row) => row.id,
  );

  // The seed's own totals, read from the fixtures rather than retyped here.
  // The fixture set was rewritten around the reachable demo personas, and
  // hard-coded counts below would have had to move one by one.
  const seededTotal = fixtureNotifications.length;
  const seededUnread = fixtureNotifications.filter((n) => !n.read).length;
  const seededFor = (handle: string) =>
    fixtureNotifications.filter((n) => n.userId === handle);

  /** Rows this run creates through the product's own paths, to be removed again. */
  const createdPostIds: string[] = [];
  const createdMessageIds: string[] = [];

  // ── A. Reading ────────────────────────────────────────────────────────
  const mine = await ingrid.from("notifications").select("id");
  expect("mottakeren ser sine egne varsler", (mine.data ?? []).length, seededFor("ingrid").length);

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
  expect("ingen nye rader ble laget", afterInserts, seededTotal);

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
  expect("alle radene er fortsatt der", afterDeletes, seededTotal);

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

  // ── K. Announcements notify the community ─────────────────────────────
  //
  // Publishing a feed announcement fans out to every active member of that
  // community except its author. The fan-out is an AFTER INSERT trigger on
  // `posts`, so there is no callable generator to test — what these cases
  // exercise is the ordinary publish path, through PostgREST under the same
  // policies the composer uses.
  const [amina, nadia, linn, marte, lars, octavio] = await Promise.all([
    signIn(await emailFor("amina")), // moderator, Tryggere Ruspolitikk
    signIn(await emailFor("nadia")), // moderator, Tryggere Ruspolitikk
    signIn(await emailFor("linn")), // ordinary member, Tryggere Ruspolitikk
    signIn(await emailFor("marte")), // moderator, Under The Rug
    signIn(await emailFor("larsbror")), // administrator, Tryggere Ruspolitikk
    signIn(await emailFor("octavio")), // administrator, Under The Rug
  ]);

  const activeIn = async (communityId: string) => {
    const { count } = await admin
      .from("memberships")
      .select("*", { count: "exact", head: true })
      .eq("community_id", communityId)
      .eq("status", "active");
    return count ?? 0;
  };

  /** Notifications created since this run began, newest first. */
  const notificationsSince = async (communityId: string) => {
    const { data } = await admin
      .from("notifications")
      .select("id, user_id, kind, community_id, title, body, href, read")
      .eq("community_id", communityId)
      .eq("kind", "announcement")
      .not("id", "in", `(${seededNotificationIds.join(",")})`);
    return data ?? [];
  };

  const publish = (
    client: SupabaseClient<Database>,
    communityId: string,
    fields: Record<string, unknown>,
  ) =>
    client
      .from("posts")
      .insert({ community_id: communityId, kind: "announcement", body: "Sjekk: kunngjøring", ...fields })
      .select("id")
      .single();

  // A. Who may publish one at all.
  const memberTries = await publish(linn, TR, { title: "Sjekk: medlemmets kunngjøring" });
  expect("medlem kan ikke publisere kunngjøring", memberTries.error !== null, true);
  expect("og ingen varsler ble laget", (await notificationsSince(TR)).length, 0);

  const trActive = await activeIn(TR);
  expect("Tryggere har ti aktive medlemmer", trActive, 10);

  // B. Fan-out, from staff.
  const adminPost = await publish(amina, TR, { title: "Sjekk: kunngjøring fra administrator" });
  expect("moderator kan publisere kunngjøring", adminPost.error, null);
  createdPostIds.push(adminPost.data!.id);

  const fanOut = await notificationsSince(TR);
  expect("alle aktive medlemmer utenom forfatteren fikk varsel", fanOut.length, trActive - 1);

  const aminaId = await profileId("amina");
  expect("forfatteren fikk ingen", fanOut.filter((n) => n.user_id === aminaId).length, 0);

  const perRecipient = new Set(fanOut.map((n) => n.user_id));
  expect("nøyaktig ett varsel per mottaker", perRecipient.size, fanOut.length);

  const activeMembers = (
    await admin.from("memberships").select("user_id").eq("community_id", TR).eq("status", "active")
  ).data!.map((m) => m.user_id);
  expect(
    "og alle mottakerne er aktive medlemmer av dette fellesskapet",
    fanOut.every((n) => activeMembers.includes(n.user_id)),
    true,
  );

  // C. What the notification says.
  // A fallback rather than `fanOut[0]!`: if generation is removed entirely the
  // content checks below should each report what is missing, not crash on the
  // first property access and take the rest of the run with them.
  const sample = fanOut[0] ?? {
    kind: "(ingen varsler)",
    community_id: "(ingen varsler)",
    href: "(ingen varsler)",
    title: "(ingen varsler)",
    body: "",
    read: "(ingen varsler)",
  };
  expect("varselet er av typen kunngjøring", sample.kind, "announcement");
  expect("og hører til riktig fellesskap", sample.community_id, TR);
  expect("lenken peker på fellesskapets feed", sample.href, `/community/${TR}/feed`);
  expect("lenken er en intern sti", internalHref(sample.href), sample.href);
  expect(
    "tittelen navngir kunngjøringen, med samme prefiks som de seedede",
    sample.title,
    "Ny kunngjøring: Sjekk: kunngjøring fra administrator",
  );
  expect("teksten navngir forfatteren", sample.body.startsWith("Amina Sørhaug publiserte"), true);
  expect("og fellesskapet", sample.body.includes("Tryggere Ruspolitikk"), true);
  expect("varselet starter som ulest", sample.read, false);

  // D. No update ever fans out again. This is where a duplicate would come
  // from if the trigger were widened, and pinning is the obvious candidate.
  const beforeUpdates = (await notificationsSince(TR)).length;
  await amina.rpc("set_post_pinned", { p_post_id: adminPost.data!.id, p_pinned: true });
  expect("å feste kunngjøringen lager ingen nye varsler", (await notificationsSince(TR)).length, beforeUpdates);
  await amina.rpc("set_post_pinned", { p_post_id: adminPost.data!.id, p_pinned: false });
  expect("å løsne den heller ikke", (await notificationsSince(TR)).length, beforeUpdates);

  await amina
    .from("posts")
    .update({ body: "Sjekk: kunngjøring, endret" })
    .eq("id", adminPost.data!.id);
  expect("å endre teksten lager ingen nye varsler", (await notificationsSince(TR)).length, beforeUpdates);

  // E. An ordinary post notifies nobody, pinned or not. Published by a
  // moderator: feed posts are staff-only, and what is under test here is the
  // kind, not who wrote it.
  const ordinary = await nadia
    .from("posts")
    .insert({ community_id: TR, body: "Sjekk: helt vanlig innlegg" })
    .select("id")
    .single();
  expect("vanlig innlegg går gjennom", ordinary.error, null);
  createdPostIds.push(ordinary.data!.id);
  expect("vanlig innlegg lager ingen varsler", (await notificationsSince(TR)).length, beforeUpdates);

  await nadia.rpc("set_post_pinned", { p_post_id: ordinary.data!.id, p_pinned: true });
  expect("å feste et vanlig innlegg lager ingen varsler", (await notificationsSince(TR)).length, beforeUpdates);
  await nadia.rpc("set_post_pinned", { p_post_id: ordinary.data!.id, p_pinned: false });

  // F. #kunngjoringer is a channel, and channels are silent.
  const channelBefore = (await admin.from("notifications").select("id")).data!.length;
  const announcementChannel = `${TR}--kunngjoringer`;
  const posted = await nadia
    .from("messages")
    .insert({ channel_id: announcementChannel, body: "Sjekk: melding i kunngjøringskanalen" })
    .select("id")
    .single();
  expect("moderator kan skrive i #kunngjoringer", posted.error, null);
  createdMessageIds.push(posted.data!.id);
  expect(
    "men kanalen lager ingen varsler",
    (await admin.from("notifications").select("id")).data!.length,
    channelBefore,
  );

  // G. A moderator publishing, and the author exclusion again for that role.
  const modPost = await publish(nadia, TR, { title: "Sjekk: kunngjøring fra moderator" });
  expect("moderator kan publisere kunngjøring", modPost.error, null);
  createdPostIds.push(modPost.data!.id);

  const nadiaId = await profileId("nadia");
  const modFanOut = (await notificationsSince(TR)).filter(
    (n) => n.title === "Ny kunngjøring: Sjekk: kunngjøring fra moderator",
  );
  expect("moderatorens kunngjøring nådde alle andre aktive", modFanOut.length, trActive - 1);
  expect("og ikke moderatoren selv", modFanOut.filter((n) => n.user_id === nadiaId).length, 0);

  // H. Only active memberships. Nothing writes 'requested' any more, so the
  // case has to be constructed as the service role to be tested at all.
  const outsider = await profileId("sofie");
  await admin
    .from("memberships")
    .insert({ user_id: outsider, community_id: TR, role: "member", status: "requested" });
  const pendingPost = await publish(amina, TR, { title: "Sjekk: kunngjøring med ventende medlem" });
  createdPostIds.push(pendingPost.data!.id);
  const pendingFanOut = (await notificationsSince(TR)).filter(
    (n) => n.title === "Ny kunngjøring: Sjekk: kunngjøring med ventende medlem",
  );
  expect("ventende medlemskap får ikke varsel", pendingFanOut.filter((n) => n.user_id === outsider).length, 0);
  expect("og fan-out er fortsatt bare de aktive", pendingFanOut.length, trActive - 1);
  await admin.from("memberships").delete().eq("user_id", outsider).eq("community_id", TR);

  // I. Community isolation, both directions.
  const utrBefore = (await notificationsSince(UTR)).length;
  expect("ingen kunngjøringsvarsler i UTR ennå", utrBefore, 0);

  const crossCommunity = await publish(nadia, UTR, { title: "Sjekk: moderator utenfor sitt fellesskap" });
  expect("moderator i ett fellesskap kan ikke kunngjøre i et annet", crossCommunity.error !== null, true);
  expect("og det lagde ingen varsler", (await notificationsSince(UTR)).length, 0);

  const utrPost = await publish(marte, UTR, { title: "Sjekk: kunngjøring i UTR" });
  expect("UTR-moderator kan kunngjøre i UTR", utrPost.error, null);
  createdPostIds.push(utrPost.data!.id);

  const utrFanOut = await notificationsSince(UTR);
  const utrActive = await activeIn(UTR);
  expect("UTR-kunngjøringen nådde UTRs aktive medlemmer", utrFanOut.length, utrActive - 1);
  expect(
    "alle UTR-varslene peker på UTR",
    utrFanOut.every((n) => n.community_id === UTR),
    true,
  );

  // Ingrid is an ordinary member of UTR and a moderator of Tryggere. She
  // is a recipient here because of the UTR membership and nothing else.
  const ingridUtr = utrFanOut.filter((n) => n.user_id === ingridId);
  expect("den som er medlem begge steder fikk nøyaktig ett UTR-varsel", ingridUtr.length, 1);

  // The Tryggere fan-out did not touch anyone who is only in UTR.
  const utrOnly = (
    await admin.from("memberships").select("user_id").eq("community_id", UTR).eq("status", "active")
  ).data!.map((m) => m.user_id).filter((id) => !activeMembers.includes(id));
  const trFanOutAll = await notificationsSince(TR);
  expect(
    "Tryggere-varslene nådde ingen som bare er i UTR",
    trFanOutAll.some((n) => utrOnly.includes(n.user_id)),
    false,
  );

  // J. The fan-out is not callable. It is a trigger function, revoked from
  // every API role, and it takes no recipient argument to supply.
  const rpcAttempt = await amina.rpc("notify_announcement" as never);
  expect("fan-out kan ikke kalles som RPC", rpcAttempt.error !== null, true);

  const anonPublish = await anon
    .from("posts")
    .insert({ community_id: TR, kind: "announcement", body: "Sjekk: utlogget" })
    .select("id");
  expect("utlogget kan ikke publisere kunngjøring", anonPublish.error !== null, true);

  const forgedAuthor = await amina
    .from("posts")
    .insert({ community_id: TR, kind: "announcement", body: "Sjekk: forfalsket forfatter", author_id: ingridId })
    .select("id");
  expect("kan ikke kunngjøre i andres navn", forgedAuthor.error !== null, true);

  // Clean up this section: the posts, the message, and every notification the
  // fan-out produced.
  for (const id of createdPostIds) await admin.from("posts").delete().eq("id", id);
  createdPostIds.length = 0;
  for (const id of createdMessageIds) await admin.from("messages").delete().eq("id", id);
  createdMessageIds.length = 0;
  await admin
    .from("notifications")
    .delete()
    .not("id", "in", `(${seededNotificationIds.join(",")})`);

  expect(
    "varslene fra denne seksjonen er ryddet bort",
    (await admin.from("notifications").select("*", { count: "exact", head: true })).count,
    seededTotal,
  );

  // ── L. The access request lifecycle ───────────────────────────────────
  //
  // Three transitions, two of which now notify. Generation lives inside the
  // existing SECURITY DEFINER lifecycle functions, so these cases drive those
  // functions the way the application does — anonymously for the request form,
  // and as a signed-in administrator for the decision.
  //
  // The role boundary under test is `is_admin`, not `can_moderate`:
  // approve_access_request says a moderator does not decide who is admitted,
  // and the same predicate guards the queue's RLS, its page and its nav entry.
  const createdRequestEmails: string[] = [];

  const requestAccess = (
    client: SupabaseClient<Database>,
    slug: string,
    email: string,
    name?: string,
  ) => {
    createdRequestEmails.push(email);
    return client.rpc("request_community_access", {
      p_slug: slug,
      p_email: email,
      p_display_name: name,
    });
  };

  const noticesFor = async (titleLike: string) => {
    const { data } = await admin
      .from("notifications")
      .select("id, user_id, kind, community_id, title, body, href")
      .like("title", titleLike)
      .not("id", "in", `(${seededNotificationIds.join(",")})`);
    return data ?? [];
  };

  const handlesOf = async (rows: { user_id: string }[]) => {
    const { data } = await admin.from("profiles").select("id, handle");
    const byId = new Map(data!.map((p) => [p.id, p.handle]));
    return rows.map((r) => byId.get(r.user_id)!).sort();
  };

  // 1. A new request reaches exactly the administrators of that community.
  const newcomer = "sjekk.soker@example.no";
  const asked = await requestAccess(anon, TR, newcomer, "Sjekk Søker");
  expect("forespørselen ble tatt imot", asked.error, null);

  const staffNotices = await noticesFor("Sjekk Søker%");
  expect(
    "administratoren i fellesskapet fikk beskjed",
    (await handlesOf(staffNotices)).join(","),
    "larsbror",
  );
  expect("og ingen andre", staffNotices.length, 1);

  const notice = staffNotices[0] ?? {
    kind: "(ingen)",
    community_id: "(ingen)",
    href: "(ingen)",
    title: "(ingen)",
    body: "",
  };
  expect("varselet er av typen medlemskap", notice.kind, "membership");
  expect("og hører til fellesskapet det gjelder", notice.community_id, TR);
  expect("lenken går til forespørselskøen", notice.href, `/community/${TR}/requests`);
  expect("lenken er intern", internalHref(notice.href), notice.href);
  expect("tittelen navngir søkeren", notice.title, "Sjekk Søker ba om tilgang");
  expect("teksten sier hvorfor du fikk den", notice.body.includes("Du er administrator"), true);

  // The moderator is deliberately not among them: moderators cannot open the
  // queue, so a notice would point them at a page that refuses them.
  const nadiaProfile = await profileId("nadia");
  expect(
    "moderatoren fikk ingen — bare administratorer behandler forespørsler",
    staffNotices.filter((n) => n.user_id === nadiaProfile).length,
    0,
  );
  const linnProfile = await profileId("linn");
  expect("og vanlige medlemmer heller ikke", staffNotices.filter((n) => n.user_id === linnProfile).length, 0);

  // 2. Asking twice does not tell anyone twice. The insert carries
  //    `on conflict do nothing`, and the fan-out runs only when a row appeared.
  const again2 = await requestAccess(anon, TR, newcomer, "Sjekk Søker");
  expect("en gjentatt forespørsel tas også imot", again2.error, null);
  expect("men lager ingen nye varsler", (await noticesFor("Sjekk Søker%")).length, 1);

  // 3. Cross-community isolation. Ingrid moderates Tryggere and is an
  //    ordinary member of UTR, so a UTR request must not reach her.
  const utrSeeker = "sjekk.utr@example.no";
  await requestAccess(anon, UTR, utrSeeker, "Sjekk UTR");
  const utrNotices = await noticesFor("Sjekk UTR%");
  expect(
    "UTR-forespørselen nådde bare UTRs administrator",
    (await handlesOf(utrNotices)).join(","),
    "octavio",
  );
  expect(
    "og ikke den som bare er vanlig medlem der",
    utrNotices.filter((n) => n.user_id === ingridId).length,
    0,
  );
  expect(
    "alle UTR-varslene peker på UTR",
    utrNotices.every((n) => n.community_id === UTR),
    true,
  );

  // 4. The requester is never among the recipients. An address that already
  //    belongs to a member returns before the queue is touched at all.
  const aminaEmail = await emailFor("amina");
  const selfRequest = await requestAccess(anon, TR, aminaEmail, "Sjekk Selv");
  expect("en forespørsel fra et medlem tas imot uten å si noe", selfRequest.error, null);
  expect("og lager ingen varsler", (await noticesFor("Sjekk Selv%")).length, 0);

  // 5. Who may decide. The queue is administrators only, at every layer.
  const trRequest = (
    await admin.from("access_requests").select("id").eq("email", newcomer).single()
  ).data!;

  const memberRejects = await linn.rpc("reject_access_request", { p_request_id: trRequest.id });
  expect("et vanlig medlem kan ikke avslå", memberRejects.data, false);

  const moderatorRejects = await nadia.rpc("reject_access_request", { p_request_id: trRequest.id });
  expect("en moderator kan ikke avslå", moderatorRejects.data, false);

  const otherAdminRejects = await octavio.rpc("reject_access_request", { p_request_id: trRequest.id });
  expect("en administrator i et annet fellesskap kan ikke avslå", otherAdminRejects.data, false);

  const anonRejects = await anon.rpc("reject_access_request", { p_request_id: trRequest.id });
  expect("utlogget kan ikke avslå", anonRejects.data ?? null, null);

  const memberApproves = await linn.rpc("approve_access_request", { p_request_id: trRequest.id });
  expect("et vanlig medlem kan ikke godkjenne", (memberApproves.data ?? []).length, 0);
  const moderatorApproves = await nadia.rpc("approve_access_request", { p_request_id: trRequest.id });
  expect("en moderator kan ikke godkjenne", (moderatorApproves.data ?? []).length, 0);

  expect(
    "ingen av forsøkene endret forespørselen",
    (await admin.from("access_requests").select("status").eq("id", trRequest.id).single()).data!.status,
    "pending",
  );
  expect("og ingen av dem lagde varsler", (await noticesFor("Forespørselen om tilgang%")).length, 0);

  // 6. Rejection reaches an applicant who has an account.
  const sofieEmail = await emailFor("sofie");
  const sofieId = await profileId("sofie");
  await requestAccess(anon, TR, sofieEmail, "Sjekk Sofie");
  const sofieRequest = (
    await admin.from("access_requests").select("id").eq("email", sofieEmail).eq("status", "pending").single()
  ).data!;

  const rejected = await lars.rpc("reject_access_request", { p_request_id: sofieRequest.id });
  expect("administrator kan avslå", rejected.data, true);

  const rejection = await noticesFor("Forespørselen om tilgang%");
  expect("søkeren fikk nøyaktig ett varsel", rejection.length, 1);
  expect("og det er søkeren selv", rejection[0]?.user_id, sofieId);
  expect("teksten navngir fellesskapet", rejection[0]?.body.includes("Tryggere Ruspolitikk"), true);
  expect(
    "teksten røper ingen begrunnelse",
    rejection[0]?.body.includes("avslag") || rejection[0]?.body.includes("grunn"),
    false,
  );

  // The link must not lead into content they were just refused.
  expect("lenken går til den offentlige portalen", rejection[0]?.href, "/tryggere-ruspolitikk");
  expect("og ikke inn i fellesskapet", rejection[0]?.href.startsWith("/community/"), false);
  expect("lenken er intern", internalHref(rejection[0]?.href ?? ""), rejection[0]?.href);

  // Repeating the rejection changes nothing and says nothing twice.
  const rejectAgain = await lars.rpc("reject_access_request", { p_request_id: sofieRequest.id });
  expect("en gjentatt avslagshandling gjør ingenting", rejectAgain.data, false);
  expect("og lager ikke et varsel til", (await noticesFor("Forespørselen om tilgang%")).length, 1);

  // 7. Rejecting an address with no account is silent, and still succeeds.
  const stranger = "sjekk.ukjent@example.no";
  await requestAccess(anon, TR, stranger, "Sjekk Ukjent");
  const strangerRequest = (
    await admin.from("access_requests").select("id").eq("email", stranger).eq("status", "pending").single()
  ).data!;
  const rejectedStranger = await lars.rpc("reject_access_request", { p_request_id: strangerRequest.id });
  expect("avslag virker også uten konto", rejectedStranger.data, true);
  expect(
    "men det finnes ingen å varsle",
    (await noticesFor("Forespørselen om tilgang%")).length,
    1,
  );

  // 8. Approval of an address with no usable account mints an invitation and
  //    deliberately does *not* notify. The outcome travels by email, and
  //    accept_invitation_token() writes the one in-app record when the link
  //    is used — see 20260916200000 and case 10 below.
  const approvalSeeker = "sjekk.godkjent@example.no";
  await requestAccess(anon, TR, approvalSeeker, "Sjekk Godkjent");
  const approvalRequest = (
    await admin.from("access_requests").select("id").eq("email", approvalSeeker).eq("status", "pending").single()
  ).data!;
  const notificationsBeforeApproval = (
    await admin.from("notifications").select("*", { count: "exact", head: true })
  ).count;

  const approved = await lars.rpc("approve_access_request", { p_request_id: approvalRequest.id });
  const approvedRow = (approved.data as { outcome: string; token: string }[] | null)?.[0];
  expect("administrator kan godkjenne", (approved.data ?? []).length, 1);
  expect("utfallet er en invitasjon, ikke en direkte aktivering", approvedRow?.outcome, "invited");
  expect(
    "godkjenning av en konto-løs adresse lager ingen varsler — e-posten og innløsningen dekker det",
    (await admin.from("notifications").select("*", { count: "exact", head: true })).count,
    notificationsBeforeApproval,
  );
  expect(
    "men den lagde en invitasjon",
    (await admin.from("invitations").select("*", { count: "exact", head: true }).eq("request_id", approvalRequest.id)).count,
    1,
  );

  const approveAgain = await lars.rpc("approve_access_request", { p_request_id: approvalRequest.id });
  expect(
    "og en gjentatt godkjenning lager verken invitasjon eller varsel",
    (await admin.from("invitations").select("*", { count: "exact", head: true }).eq("request_id", approvalRequest.id)).count,
    1,
  );
  expect(
    "heller ikke et varsel",
    (await admin.from("notifications").select("*", { count: "exact", head: true })).count,
    notificationsBeforeApproval,
  );
  void approveAgain;

  // 9. Approval of an address that already has a *confirmed* account skips
  //    the invitation entirely: membership is activated in the same call,
  //    and — unlike case 8 — this is notified immediately, mirroring the
  //    "Du er nå medlem" notice accept_invitation_token() writes on
  //    redemption. Oskar has a UTR membership from the seed but none in
  //    Tryggere, which is what makes his address usable for this case.
  const oskarId = await profileId("oskar");
  const oskarEmail = await emailFor("oskar");
  const oskarRequested = await requestAccess(anon, TR, oskarEmail, "Sjekk Oskar");
  expect("forespørselen fra en konto som finnes fra før ble tatt imot", oskarRequested.error, null);

  const { data: oskarRequest } = await admin
    .from("access_requests")
    .select("id, community_id, email")
    .eq("email", oskarEmail)
    .eq("status", "pending")
    .single();

  const oskarNotificationsBefore = (
    await admin.from("notifications").select("id").eq("user_id", oskarId)
  ).data!.length;
  // Activating the membership also creates Oskar's Tryggere community profile
  // (memberships_ensure_community_profile). Profiles deliberately outlive
  // memberships, so deleting the membership below does not remove it; note
  // whether one existed so the undo can put it back exactly as it was.
  const oskarHadProfile =
    (
      await admin
        .from("community_profiles")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", oskarId)
        .eq("community_id", TR)
    ).count! > 0;

  const oskarApproval = await lars.rpc("approve_access_request", { p_request_id: oskarRequest!.id });
  const oskarOutcome = (oskarApproval.data as { outcome: string; token: string | null }[] | null)?.[0];
  expect("administrator kan godkjenne en konto som finnes fra før", oskarOutcome?.outcome, "activated");
  expect("og godkjenningen gir ingen token — det er ingen invitasjon å sende", oskarOutcome?.token, null);

  const oskarMembership = await admin
    .from("memberships")
    .select("status")
    .eq("user_id", oskarId)
    .eq("community_id", TR)
    .maybeSingle();
  expect("medlemskapet ble opprettet med det samme", oskarMembership.data?.status, "active");
  expect(
    "og det ble ikke laget noen invitasjon å vente på",
    (await admin.from("invitations").select("*", { count: "exact", head: true }).eq("request_id", oskarRequest!.id)).count,
    0,
  );

  const { data: oskarNoticesAfterApproval } = await admin
    .from("notifications")
    .select("id, kind, community_id, title")
    .eq("user_id", oskarId);
  expect(
    "direkte aktivering varsler med det samme",
    oskarNoticesAfterApproval!.length,
    oskarNotificationsBefore + 1,
  );
  const oskarNotice = oskarNoticesAfterApproval!.find((n) => n.title.startsWith("Du er nå medlem"));
  expect("varselet er av typen medlemskap", oskarNotice?.kind, "membership");
  expect("og hører til fellesskapet forespørselen gjaldt", oskarNotice?.community_id, TR);

  // Re-approving (a retried click) must not create a second membership row or
  // a second notice — the membership upsert is a no-op and `v_just_approved`
  // is false the second time through.
  const oskarApproveAgain = await lars.rpc("approve_access_request", { p_request_id: oskarRequest!.id });
  const oskarAgainOutcome = (oskarApproveAgain.data as { outcome: string }[] | null)?.[0];
  expect("en gjentatt godkjenning rapporterer samme utfall", oskarAgainOutcome?.outcome, "activated");
  expect(
    "uten å lage et medlemskap til",
    (await admin.from("memberships").select("*", { count: "exact", head: true }).eq("user_id", oskarId).eq("community_id", TR)).count,
    1,
  );
  expect(
    "og uten et varsel til",
    (await admin.from("notifications").select("*", { count: "exact", head: true }).eq("user_id", oskarId)).count,
    oskarNotificationsBefore + 1,
  );

  // Undo case 9: the membership, the community profile it created, its
  // notice, and the request.
  if (oskarNotice) await admin.from("notifications").delete().eq("id", oskarNotice.id);
  await admin.from("memberships").delete().eq("user_id", oskarId).eq("community_id", TR);
  if (!oskarHadProfile) {
    await admin.from("community_profiles").delete().eq("user_id", oskarId).eq("community_id", TR);
  }
  await admin.from("access_requests").delete().eq("id", oskarRequest!.id);

  // Tidy the requests case 8 and the role-boundary case above produced.
  for (const email of createdRequestEmails) {
    const { data: reqs } = await admin.from("access_requests").select("id").eq("email", email);
    for (const r of reqs ?? []) await admin.from("invitations").delete().eq("request_id", r.id);
    await admin.from("access_requests").delete().eq("email", email);
  }
  await admin
    .from("notifications")
    .delete()
    .not("id", "in", `(${seededNotificationIds.join(",")})`);

  expect(
    "forespørslene fra denne seksjonen er ryddet bort",
    (await admin.from("access_requests").select("*", { count: "exact", head: true })).count,
    2,
  );
  expect(
    "og varslene også",
    (await admin.from("notifications").select("*", { count: "exact", head: true })).count,
    seededTotal,
  );

  // ── 10. The one real generator, for the address that never gets a shortcut ─
  //
  // accept_invitation_token() is the only thing in the product that creates a
  // notification by redeeming a token rather than by an administrator's own
  // action. It inserts rather than updates, and runs as the table owner, so
  // neither new layer should be able to reach it — but that is an argument,
  // and this is the test.
  //
  // This has to run against an address with no account at all — every seeded
  // persona already has a confirmed one, and case 9 just proved those are
  // activated directly and never reach this function. `signIn()` here plays
  // the part of the person creating that account: `generateLink` +
  // `verifyOtp` for an address with no prior user is exactly what happens
  // when someone follows the claim link and logs in for the first time.
  const freshEmail = "sjekk.nykonto@example.no";
  const freshRequested = await requestAccess(anon, TR, freshEmail, "Sjekk Ny Konto");
  expect("forespørselen fra en konto-løs adresse ble tatt imot", freshRequested.error, null);

  const { data: freshRequest } = await admin
    .from("access_requests")
    .select("id, community_id, email")
    .eq("email", freshEmail)
    .eq("status", "pending")
    .single();

  const freshApproval = await lars.rpc("approve_access_request", { p_request_id: freshRequest!.id });
  const freshOutcome = (freshApproval.data as { outcome: string; token: string | null }[] | null)?.[0];
  expect("godkjenning uten konto gir en invitasjon", freshOutcome?.outcome, "invited");
  const invitationToken = freshOutcome?.token;
  expect("med en fersk token", Boolean(invitationToken), true);

  const freshClient = await signIn(freshEmail);
  const { data: freshUser } = await freshClient.auth.getUser();
  const freshUserId = freshUser.user!.id;

  const freshNotificationsBefore = (
    await admin.from("notifications").select("id").eq("user_id", freshUserId)
  ).data!.length;

  const redeemed = await freshClient.rpc("accept_invitation_token", { p_token: invitationToken! });
  const redeemOutcome = (redeemed.data as { ok: boolean; reason: string }[] | null)?.[0];
  expect("invitasjonen kunne løses inn", redeemOutcome?.ok, true);
  expect("og den ga medlemskap", redeemOutcome?.reason, "joined");

  const { data: freshNoticesAfter } = await admin
    .from("notifications")
    .select("id, kind, community_id, title")
    .eq("user_id", freshUserId);
  expect(
    "innløsningen lagde fortsatt ett varsel",
    freshNoticesAfter!.length,
    freshNotificationsBefore + 1,
  );
  const fresh = freshNoticesAfter!.find((n) => n.title.startsWith("Du er nå medlem"));
  expect("varselet er av riktig type", fresh?.kind, "membership");
  expect("og hører til riktig fellesskap", fresh?.community_id, freshRequest!.community_id);

  // A second redemption of the same token finds nothing left to consume.
  const redeemAgain = await freshClient.rpc("accept_invitation_token", { p_token: invitationToken! });
  const redeemAgainOutcome = (redeemAgain.data as { ok: boolean; reason: string }[] | null)?.[0];
  expect("gjentatt innløsning gir ingen ny medlemskap", redeemAgainOutcome?.ok, false);
  expect("og forklarer hvorfor", redeemAgainOutcome?.reason, "already-used");
  expect(
    "og lager ikke et varsel til",
    (await admin.from("notifications").select("*", { count: "exact", head: true }).eq("user_id", freshUserId)).count,
    freshNotificationsBefore + 1,
  );

  // Undo the whole thing, in reverse — including the account this case
  // created, since nothing else in this file creates and deletes auth users.
  if (fresh) await admin.from("notifications").delete().eq("id", fresh.id);
  await admin
    .from("memberships")
    .delete()
    .eq("user_id", freshUserId)
    .eq("community_id", freshRequest!.community_id);
  await admin.from("invitations").delete().eq("request_id", freshRequest!.id);
  await admin.from("access_requests").delete().eq("id", freshRequest!.id);
  await admin.auth.admin.deleteUser(freshUserId);
  await admin
    .from("notifications")
    .delete()
    .not("id", "in", `(${seededNotificationIds.join(",")})`);

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

  // ── M. The seeded set itself ──────────────────────────────────────────
  //
  // Everything above tests behaviour. This tests the fixtures, because the
  // demo is the only thing most people ever see of this feature and it spent
  // three releases advertising two that do not exist.
  const fixtureKinds = new Set(fixtureNotifications.map((n) => n.kind));
  expect("ingen seedede mention-varsler — funksjonen finnes ikke", fixtureKinds.has("mention"), false);
  expect("ingen seedede arrangementsvarsler — påminnelser finnes ikke", fixtureKinds.has("event"), false);
  expect(
    "bare typer produktet faktisk skriver",
    [...fixtureKinds].sort().join(","),
    "announcement,membership",
  );

  const fixtureIds = fixtureNotifications.map((n) => n.id);
  expect("fixture-id-ene er unike", new Set(fixtureIds).size, fixtureIds.length);
  expect("noen av dem er lest", fixtureNotifications.some((n) => n.read), true);
  expect("og noen er uleste", seededUnread > 0, true);

  // The privileged showcase personas have something to look at, and something
  // unread so the badge is not a dead ornament.
  for (const persona of ["demo-tryggere", "demo-utr"] as const) {
    const rows = seededFor(persona);
    expect(`${asHandle(persona)} har seedede varsler`, rows.length > 0, true);
    expect(`${asHandle(persona)} har minst ett ulest`, rows.some((n) => !n.read), true);
  }

  // Every seeded link is an internal path that actually resolves.
  const routes = new Set<string>();
  for (const community of [TR, "tryggere-ungdom", UTR]) {
    routes.add(`/community/${community}`);
    routes.add(`/community/${community}/feed`);
    routes.add(`/community/${community}/requests`);
  }
  for (const row of fixtureNotifications) {
    expect(`lenken i ${row.id} er intern`, internalHref(row.href), row.href);
    expect(`lenken i ${row.id} peker på en rute som finnes`, routes.has(row.href), true);
  }

  // The rule the fixtures must not quietly break: a seeded notification may
  // never hand its recipient something their role in that community does not
  // already give them. An announcement needs active membership; a request
  // notice needs `admin`, which is what approve_access_request requires and
  // what the queue's own policy enforces.
  const { data: allMemberships } = await admin
    .from("memberships")
    .select("community_id, status, role, profiles!memberships_user_id_fkey!inner(handle)");
  const roleIn = new Map(
    (allMemberships as unknown as {
      community_id: string;
      status: string;
      role: string;
      profiles: { handle: string };
    }[]).map((m) => [`${m.profiles.handle}|${m.community_id}`, `${m.role}|${m.status}`]),
  );
  const handleOf = new Map(
    (await admin.from("profiles").select("id, handle")).data!.map((p) => [p.id, p.handle]),
  );
  void handleOf;

  for (const row of fixtureNotifications) {
    if (!row.communityId) continue;
    const role = roleIn.get(`${asHandle(row.userId)}|${row.communityId}`) ?? "(ingen)";
    expect(`${row.id}: mottakeren er aktivt medlem der`, role.endsWith("|active"), true);

    if (row.href.endsWith("/requests")) {
      expect(`${row.id}: bare administratorer får forespørselsvarsler`, role, "admin|active");
    }
  }

  // Stated the other way round, because it is the case most likely to be got
  // wrong: Kari moderates Tryggere Ungdom, and moderators do not process
  // requests, so she must have no request notice there.
  expect(
    "moderatorrollen gir ingen forespørselsvarsler",
    fixtureNotifications.filter(
      (n) => n.userId === "demo-tryggere" && n.communityId === "tryggere-ungdom" && n.href.endsWith("/requests"),
    ).length,
    0,
  );

  // An announcement notice must never be about the recipient's own post.
  const { data: announcementPosts } = await admin
    .from("posts")
    .select("title, community_id, profiles!inner(handle)")
    .eq("kind", "announcement");
  for (const row of fixtureNotifications.filter((n) => n.kind === "announcement")) {
    const post = (announcementPosts as unknown as {
      title: string;
      community_id: string;
      profiles: { handle: string };
    }[]).find((p) => row.title === `Ny kunngjøring: ${p.title}` && p.community_id === row.communityId);
    expect(`${row.id}: kunngjøringen finnes faktisk`, Boolean(post), true);
    expect(`${row.id}: og mottakeren skrev den ikke selv`, post?.profiles.handle === asHandle(row.userId), false);
  }

  // The seed is deterministic: what is in the database is exactly the fixture
  // set, once each. A second seed cannot add to it, which is the property that
  // matters when the seed is run repeatedly during a demo.
  const { data: live } = await admin
    .from("notifications")
    .select("title, read, href, profiles!inner(handle)");
  const liveKey = (r: { profiles: { handle: string }; title: string; read: boolean; href: string }) =>
    `${r.profiles.handle}|${r.title}|${r.read}|${r.href}`;
  const liveRows = (live as unknown as {
    profiles: { handle: string };
    title: string;
    read: boolean;
    href: string;
  }[]).map(liveKey).sort();
  const wantRows = fixtureNotifications
    .map((n) => `${asHandle(n.userId)}|${n.title}|${n.read}|${n.href}`)
    .sort();
  expect("databasen holder nøyaktig fixture-settet", liveRows.join("\n"), wantRows.join("\n"));

  // ── Back to where we started ──────────────────────────────────────────
  const { count: finalCount } = await admin
    .from("notifications")
    .select("*", { count: "exact", head: true });
  expect("like mange varsler som i seed", finalCount, seededTotal);

  const { count: finalUnread } = await admin
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("read", false);
  expect("og like mange uleste", finalUnread, seededUnread);

  const { count: memberships } = await admin
    .from("memberships")
    .select("*", { count: "exact", head: true });
  expect("medlemskapene er tilbake til 30", memberships, 30);

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
