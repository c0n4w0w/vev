/**
 * Checks private lokallag chat channels under real authenticated sessions.
 *
 * The rule (20261001100000_lokallag_channels): a channel with
 * `local_group_id` set is readable and writable only by active members whose
 * membership is in exactly that group. No admin or moderator override, no
 * cross-community reach. Community-wide channels keep their old rule.
 *
 * Every access check goes through ordinary anon-key clients signed in as
 * fixture accounts, running the same queries the app runs (`loadChannels`,
 * `getMessages`, `getLatestMessage`, `createMessage`), so a passing run means
 * the *database* refuses — not that a page hides a link. Membership changes go
 * through `set_my_local_group()`, the path the /lokallag page uses. The service
 * role is used only to read state back, to call the internal
 * `ensure_local_group_channel()` for the idempotency check, and to clean up.
 *
 * Run with `npm run check:lokallag-channels` against the local stack after
 * `npm run seed`. Leaves fixture state as it found it, and clears leftovers
 * from an interrupted earlier run first.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { channels as fixtureChannels } from "@/lib/mock/communities";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

const FTR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const BODY = "CHECK lokallagskanal";
const GROUP_PREFIX = "CHECK lokallag";

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

type Client = SupabaseClient<Database>;

async function profileId(handle: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw error;
  return data.id;
}

async function signIn(handle: string): Promise<Client> {
  const { data: user, error: userError } = await admin.auth.admin.getUserById(await profileId(handle));
  if (userError) throw userError;
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.user!.email!,
  });
  if (error || !data.properties) throw new Error(`kunne ikke lage lenke for ${handle}: ${error?.message}`);
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw verifyError;
  return client;
}

async function groupId(communityId: string, name: string): Promise<string> {
  const { data, error } = await admin
    .from("community_local_groups")
    .select("id")
    .eq("community_id", communityId)
    .eq("name", name)
    .single();
  if (error) throw error;
  return data.id;
}

async function channelFor(localGroupId: string) {
  const { data, error } = await admin.from("channels").select("*").eq("local_group_id", localGroupId);
  if (error) throw error;
  return data;
}

async function membershipGroup(handle: string, communityId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("memberships")
    .select("local_group_id")
    .eq("community_id", communityId)
    .eq("user_id", await profileId(handle))
    .single();
  if (error) throw error;
  return data.local_group_id;
}

/** Exactly what `loadChannels()` asks for — the sidebar, Overview and home page read. */
async function visibleChannels(client: Client, communityId: string) {
  const { data, error } = await client
    .from("channels")
    .select("*")
    .eq("community_id", communityId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data;
}

/** `getChannel()` — the direct channel route. */
async function directChannel(client: Client, channelId: string) {
  const { data } = await client.from("channels").select("*").eq("id", channelId).maybeSingle();
  return data;
}

/** `getMessages()`. */
async function readMessages(client: Client, channelId: string) {
  const { data } = await client
    .from("messages")
    .select("*")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

/** `getLatestMessage()`. */
async function latestMessage(client: Client, channelId: string) {
  const { data } = await client
    .from("messages")
    .select("*")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

const createdMessageIds: string[] = [];

/** `createMessage()`: author comes from the column default. */
async function send(client: Client, channelId: string, note: string) {
  const { data, error } = await client
    .from("messages")
    .insert({ channel_id: channelId, body: `${BODY}: ${note}` })
    .select("id")
    .maybeSingle();
  if (data?.id) createdMessageIds.push(data.id);
  return { id: data?.id ?? null, error };
}

async function notificationCount() {
  const { count, error } = await admin.from("notifications").select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

async function setMyGroup(client: Client, communityId: string, localGroupId: string | null) {
  const { data, error } = await client.rpc("set_my_local_group", {
    p_community_id: communityId,
    // Postgres accepts null here to clear; generated RPC argument types do not
    // record argument nullability.
    p_local_group_id: localGroupId as unknown as string,
  });
  return !error && data === true;
}

/** Removes CHECK groups, their channels and messages, and CHECK messages anywhere. */
async function cleanup() {
  await admin.from("messages").delete().like("body", `${BODY}%`);
  const { data: groups } = await admin
    .from("community_local_groups")
    .select("id, community_id")
    .like("name", `${GROUP_PREFIX}%`);
  for (const group of groups ?? []) {
    // Anyone still pointing at a CHECK group goes back to none; the fixture
    // never assigns one.
    await admin.from("memberships").update({ local_group_id: null }).eq("local_group_id", group.id);
    const { data: channels } = await admin.from("channels").select("id").eq("local_group_id", group.id);
    for (const channel of channels ?? []) {
      await admin.from("messages").delete().eq("channel_id", channel.id);
      await admin.from("channels").delete().eq("id", channel.id);
    }
    await admin.from("community_local_groups").delete().eq("id", group.id);
  }
}

async function main() {
  await cleanup();

  const ftrOslo = await groupId(FTR, "FTR Oslo");
  const ftrTrondelag = await groupId(FTR, "FTR Trøndelag");
  const ftrVestland = await groupId(FTR, "FTR Vestland");
  const tuOslo = await groupId(TU, "TU Oslo");

  const [osloChannel] = await channelFor(ftrOslo);
  const [trondelagChannel] = await channelFor(ftrTrondelag);
  const [vestlandChannel] = await channelFor(ftrVestland);
  const [tuOsloChannel] = await channelFor(tuOslo);
  if (!osloChannel || !trondelagChannel || !vestlandChannel || !tuOsloChannel) {
    throw new Error("lokallagskanalene finnes ikke — kjør migrasjonen og `npm run seed` først");
  }

  const communityWide = fixtureChannels.filter((c) => c.communityId === FTR).map((c) => c.id);

  const kristoffer = await signIn("kristoffer"); // FTR Oslo, member
  const eli = await signIn("elironning"); // FTR Trøndelag, member
  const elise = await signIn("elise"); // FTR, no local group
  const lars = await signIn("larsbror"); // FTR admin, no local group
  const ingrid = await signIn("ingrid"); // FTR moderator, no local group
  const nadia = await signIn("nadia"); // FTR moderator, FTR Vestland
  const amina = await signIn("amina"); // FTR moderator, FTR Oslo
  const petter = await signIn("petter"); // FTR Trøndelag, TU Trøndelag
  const emma = await signIn("emmamortensen"); // TU admin, no FTR membership
  const hanne = await signIn("hanne"); // TU moderator, TU Oslo
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());

  // Baseline the persona affiliations this suite relies on.
  expect("kristoffer er i FTR Oslo", await membershipGroup("kristoffer", FTR), ftrOslo);
  expect("eli er i FTR Trøndelag", await membershipGroup("elironning", FTR), ftrTrondelag);
  expect("elise har ikke lokallag", await membershipGroup("elise", FTR), null);
  expect("lars har ikke lokallag", await membershipGroup("larsbror", FTR), null);
  expect("petter er i FTR Trøndelag", await membershipGroup("petter", FTR), ftrTrondelag);

  const petterOriginal = await membershipGroup("petter", FTR);
  const larsOriginal = await membershipGroup("larsbror", FTR);
  const notificationsBefore = await notificationCount();

  try {
    // ── A. Channel existence ────────────────────────────────────────────
    {
      const { data: groups } = await admin.from("community_local_groups").select("id, name, active");
      const { data: lokal } = await admin.from("channels").select("id, local_group_id, group_id, name").not("local_group_id", "is", null);
      const perGroup = new Map<string, number>();
      for (const channel of lokal ?? []) {
        perGroup.set(channel.local_group_id!, (perGroup.get(channel.local_group_id!) ?? 0) + 1);
      }
      const active = (groups ?? []).filter((g) => g.active);
      expect("A1 det finnes aktive lokallag å sjekke", active.length > 0, true);
      expect(
        "A1 hvert aktive lokallag har nøyaktig én kanal",
        active.filter((g) => perGroup.get(g.id) !== 1).map((g) => g.name).join(", "),
        "",
      );
      expect(
        "A1 kanalnavnet følger lokallaget",
        active.filter((g) => lokal?.find((c) => c.local_group_id === g.id)?.name !== g.name).map((g) => g.name).join(", "),
        "",
      );
      expect("A1 alle lokallagskanaler ligger under seksjonen lokallag", (lokal ?? []).every((c) => c.group_id === "lokallag"), true);

      const before = (lokal ?? []).length;
      for (let round = 0; round < 2; round += 1) {
        for (const group of active) {
          const { data: id } = await admin.rpc("ensure_local_group_channel", { p_local_group_id: group.id });
          if (group.id === ftrOslo) expect("A2 gjentatt oppsett gir samme kanal-id", id, osloChannel.id);
        }
      }
      const { count: after } = await admin.from("channels").select("id", { count: "exact", head: true }).not("local_group_id", "is", null);
      expect("A2 gjentatt oppsett lager ingen duplikater", after, before);

      // No API role may call the internal helpers.
      const { error: memberEnsure } = await kristoffer.rpc("ensure_local_group_channel", { p_local_group_id: ftrOslo });
      expect("A2 medlem kan ikke kalle ensure_local_group_channel", Boolean(memberEnsure), true);
      const { error: memberAdmits } = await kristoffer.rpc("channel_scope_admits", {
        p_user_id: await profileId("elironning"),
        p_community_id: FTR,
        p_local_group_id: ftrTrondelag,
      });
      expect("A2 medlem kan ikke spørre om andres tilgang", Boolean(memberAdmits), true);
    }

    // A3–A5, H31: a new group through the admin path, renamed and retired.
    {
      const name = `${GROUP_PREFIX} Nord`;
      const { data: newGroup, error } = await lars.rpc("create_local_group", { p_community_id: FTR, p_name: name });
      expect("A3 admin oppretter lokallag", Boolean(newGroup) && !error, true);
      const [channel] = await channelFor(newGroup!);
      expect("A3 nytt lokallag får kanal automatisk", Boolean(channel), true);
      expect("A3 kanalen heter som lokallaget", channel?.name, name);
      expect("A3 kanalen er i samme fellesskap", channel?.community_id, FTR);
      expect("A3 admin uten tilhørighet ser ikke den nye kanalen", await directChannel(lars, channel.id), null);

      // The creating admin joins it — the only way staff get in — and writes.
      expect("A3 admin velger det nye lokallaget", await setMyGroup(lars, FTR, newGroup!), true);
      expect("E19 admin som er medlem av lokallaget ser kanalen", (await directChannel(lars, channel.id))?.id, channel.id);
      const sent = await send(lars, channel.id, "før navnebytte");
      expect("E19 admin som er medlem kan skrive", sent.error, null);

      const renamed = `${GROUP_PREFIX} Nord-Norge`;
      const { data: renameOk } = await lars.rpc("rename_local_group", { p_local_group_id: newGroup!, p_name: renamed });
      expect("A4 admin gir lokallaget nytt navn", renameOk, true);
      const [afterRename] = await channelFor(newGroup!);
      expect("A4 kanal-id er uendret etter navnebytte", afterRename?.id, channel.id);
      expect("A4 kanalnavnet følger nytt navn", afterRename?.name, renamed);
      const history = await readMessages(lars, channel.id);
      expect("H31 meldingen er fortsatt knyttet til kanalen etter navnebytte", history.some((m) => m.id === sent.id), true);

      const long = `${GROUP_PREFIX} ${"x".repeat(80 - GROUP_PREFIX.length - 1)}`;
      expect("A4 testnavnet er på grensen (80)", long.length, 80);
      await lars.rpc("rename_local_group", { p_local_group_id: newGroup!, p_name: long });
      const [afterLong] = await channelFor(newGroup!);
      expect("A4 langt lokallagsnavn kortes til 40 tegn i kanalen", afterLong?.name.length, 40);
      expect("A4 langt navn endrer ikke kanal-id", afterLong?.id, channel.id);

      // Admin editing of the channel itself is refused for lokallag channels,
      // even for an admin who is in the group.
      const { data: edited } = await lars.rpc("set_channel_details", {
        p_community_id: FTR,
        p_channel_id: channel.id,
        p_name: "overstyrt",
        p_purpose: "overstyrt",
      });
      expect("A4 set_channel_details avviser lokallagskanaler", (edited ?? []).length, 0);

      const { data: retireOk } = await lars.rpc("set_local_group_active", { p_local_group_id: newGroup!, p_active: false });
      expect("A5 admin avvikler lokallaget", retireOk, true);
      const [afterRetire] = await channelFor(newGroup!);
      expect("A5 kanalen finnes etter avvikling", afterRetire?.id, channel.id);
      expect("A5 meldingene finnes etter avvikling", (await readMessages(lars, channel.id)).some((m) => m.id === sent.id), true);
      expect("A5 medlem som beholdes i avviklet lokallag har fortsatt tilgang", (await directChannel(lars, channel.id))?.id, channel.id);
      expect("A5 avviklet lokallag kan ikke velges av nye", await setMyGroup(kristoffer, FTR, newGroup!), false);
      expect("A5 kristoffer er fortsatt i FTR Oslo", await membershipGroup("kristoffer", FTR), ftrOslo);

      const { data: reactivate } = await lars.rpc("set_local_group_active", { p_local_group_id: newGroup!, p_active: true });
      expect("A5 lokallaget kan gjeninnføres", reactivate, true);
      expect("A5 gjeninnføring gir fortsatt bare én kanal", (await channelFor(newGroup!)).length, 1);

      expect("A3 admin går tilbake til ingen lokallag", await setMyGroup(lars, FTR, larsOriginal), true);
      expect("A3 admin uten tilhørighet mister tilgangen igjen", await directChannel(lars, channel.id), null);
      expect("A3 admin uten tilhørighet kan ikke lese meldingene", (await readMessages(lars, channel.id)).length, 0);

      // A group that is created already retired gets no channel: that would be
      // new access to a group nobody can join. Reinstating it creates one.
      const { data: retired } = await admin
        .from("community_local_groups")
        .insert({ community_id: FTR, name: `${GROUP_PREFIX} Avviklet`, slug: "check-lokallag-avviklet", active: false })
        .select("id")
        .single();
      expect("A5 lokallag opprettet som avviklet får ingen kanal", (await channelFor(retired!.id)).length, 0);
      await admin.from("community_local_groups").update({ active: true }).eq("id", retired!.id);
      expect("A5 gjeninnført lokallag får kanal", (await channelFor(retired!.id)).length, 1);
    }

    // Seed one message in each of the two groups, written by their members.
    const osloSeed = await send(amina, osloChannel.id, "oslo fra moderator i oslo");
    expect("E19 moderator i FTR Oslo kan skrive i Oslo", osloSeed.error, null);
    const trSeed = await send(eli, trondelagChannel.id, "trøndelag");
    expect("C13 Trøndelag-medlem kan skrive i Trøndelag", trSeed.error, null);

    // ── B. FTR Oslo member ──────────────────────────────────────────────
    {
      const seen = await visibleChannels(kristoffer, FTR);
      const ids = seen.map((c) => c.id);
      expect("B6 Oslo-medlem ser alle fellesskapskanaler", communityWide.every((id) => ids.includes(id)), true);
      expect("B7 Oslo-medlem ser FTR Oslo-kanalen", ids.includes(osloChannel.id), true);
      expect("B8 Oslo-medlem ser ikke FTR Trøndelag-kanalen", ids.includes(trondelagChannel.id), false);
      expect("B8 Oslo-medlem ser nøyaktig én lokallagskanal", seen.filter((c) => c.local_group_id).length, 1);
      expect("B9 Oslo-medlem leser Oslo-meldinger", (await readMessages(kristoffer, osloChannel.id)).some((m) => m.id === osloSeed.id), true);
      const sent = await send(kristoffer, osloChannel.id, "oslo fra medlem");
      expect("B10 Oslo-medlem kan skrive i Oslo", sent.error, null);
      expect("B11 Oslo-medlem kan ikke lese Trøndelag-meldinger", (await readMessages(kristoffer, trondelagChannel.id)).length, 0);
      const denied = await send(kristoffer, trondelagChannel.id, "skal ikke lagres");
      expect("B11 Oslo-medlem kan ikke skrive i Trøndelag", denied.id === null && Boolean(denied.error), true);
      expect("B12 direkte oppslag av Trøndelag-kanalen gir ingenting", await directChannel(kristoffer, trondelagChannel.id), null);
      const { data: canRead } = await kristoffer.rpc("can_read_channel", { chid: trondelagChannel.id });
      expect("B12 can_read_channel(Trøndelag) er false for Oslo-medlem", canRead, false);
    }

    // ── C. FTR Trøndelag member ─────────────────────────────────────────
    {
      const seen = await visibleChannels(eli, FTR);
      const ids = seen.map((c) => c.id);
      expect("C13 Trøndelag-medlem ser alle fellesskapskanaler", communityWide.every((id) => ids.includes(id)), true);
      expect("C13 Trøndelag-medlem ser FTR Trøndelag-kanalen", ids.includes(trondelagChannel.id), true);
      expect("C13 Trøndelag-medlem ser ikke FTR Oslo-kanalen", ids.includes(osloChannel.id), false);
      expect("C13 Trøndelag-medlem leser Trøndelag-meldinger", (await readMessages(eli, trondelagChannel.id)).some((m) => m.id === trSeed.id), true);
      expect("C13 Trøndelag-medlem kan ikke lese Oslo-meldinger", (await readMessages(eli, osloChannel.id)).length, 0);
      const denied = await send(eli, osloChannel.id, "skal ikke lagres");
      expect("C13 Trøndelag-medlem kan ikke skrive i Oslo", denied.id === null && Boolean(denied.error), true);
      expect("C13 direkte oppslag av Oslo-kanalen gir ingenting", await directChannel(eli, osloChannel.id), null);
    }

    // ── D. No local group ───────────────────────────────────────────────
    {
      const seen = await visibleChannels(elise, FTR);
      const ids = seen.map((c) => c.id);
      expect("D14 medlem uten lokallag ser alle fellesskapskanaler", communityWide.every((id) => ids.includes(id)), true);
      expect("D15 medlem uten lokallag ser ingen lokallagskanal", seen.filter((c) => c.local_group_id).length, 0);
      const { data: anyLocal } = await elise.from("channels").select("id").not("local_group_id", "is", null);
      expect("D16 medlem uten lokallag finner ingen lokallagskanal i noe fellesskap", (anyLocal ?? []).length, 0);
      expect("D16 medlem uten lokallag leser ingen Oslo-meldinger", (await readMessages(elise, osloChannel.id)).length, 0);
      const denied = await send(elise, osloChannel.id, "skal ikke lagres");
      expect("D16 medlem uten lokallag kan ikke skrive i Oslo", denied.id === null && Boolean(denied.error), true);
    }

    // ── E. Staff ────────────────────────────────────────────────────────
    {
      expect("E17 FTR-admin utenfor Oslo ser ikke Oslo-kanalen", await directChannel(lars, osloChannel.id), null);
      expect("E17 FTR-admin utenfor Oslo leser ingen Oslo-meldinger", (await readMessages(lars, osloChannel.id)).length, 0);
      expect("E17 FTR-admin utenfor Oslo kan ikke skrive i Oslo", (await send(lars, osloChannel.id, "nei")).id, null);
      expect("E17 FTR-admin ser ingen lokallagskanaler i sidepanelet", (await visibleChannels(lars, FTR)).filter((c) => c.local_group_id).length, 0);
      const { data: edited } = await lars.rpc("set_channel_details", {
        p_community_id: FTR,
        p_channel_id: osloChannel.id,
        p_name: "lekket",
        p_purpose: "lekket",
      });
      expect("E17 admin-redigering avslører ikke Oslo-kanalen", (edited ?? []).length, 0);
      expect("E17 Oslo-kanalen er uendret etter forsøket", (await channelFor(ftrOslo))[0]?.name, "FTR Oslo");

      expect("E18 FTR-moderator uten lokallag ser ikke Oslo", await directChannel(ingrid, osloChannel.id), null);
      expect("E18 FTR-moderator uten lokallag leser ikke Oslo", (await readMessages(ingrid, osloChannel.id)).length, 0);
      expect("E18 FTR-moderator i Vestland ser ikke Oslo", await directChannel(nadia, osloChannel.id), null);
      expect("E18 FTR-moderator i Vestland leser ikke Oslo", (await readMessages(nadia, osloChannel.id)).length, 0);
      expect("E18 FTR-moderator i Vestland ser Vestland", (await directChannel(nadia, vestlandChannel.id))?.id, vestlandChannel.id);

      expect("E19 moderator i FTR Oslo ser Oslo", (await directChannel(amina, osloChannel.id))?.id, osloChannel.id);
      expect("E19 moderator i FTR Oslo ser ikke Trøndelag", await directChannel(amina, trondelagChannel.id), null);

      expect("E20 TU-admin ser ikke FTR Oslo", await directChannel(emma, osloChannel.id), null);
      expect("E20 TU-admin leser ikke FTR Oslo", (await readMessages(emma, osloChannel.id)).length, 0);
      expect("E20 TU Oslo-medlem ser ikke FTR Oslo", await directChannel(hanne, osloChannel.id), null);
      expect("E20 TU Oslo-medlem kan ikke skrive i FTR Oslo", (await send(hanne, osloChannel.id, "nei")).id, null);
      expect("E20 TU Oslo-medlem ser TU Oslo", (await directChannel(hanne, tuOsloChannel.id))?.id, tuOsloChannel.id);
      expect("E20 FTR Oslo-medlem ser ikke TU Oslo", await directChannel(kristoffer, tuOsloChannel.id), null);
      expect("E20 uautentisert ser ingen kanaler", (await anon.from("channels").select("id")).data?.length ?? 0, 0);
      expect("E20 uautentisert leser ingen meldinger", (await readMessages(anon, osloChannel.id)).length, 0);
    }

    // ── F. Membership change ───────────────────────────────────────────
    {
      expect("F21 Petter ser Trøndelag før byttet", (await directChannel(petter, trondelagChannel.id))?.id, trondelagChannel.id);
      expect("F21 Petter leser Trøndelag før byttet", (await readMessages(petter, trondelagChannel.id)).some((m) => m.id === trSeed.id), true);
      expect("F21 Petter ser ikke Oslo før byttet", await directChannel(petter, osloChannel.id), null);

      expect("F22 Petter bytter til FTR Oslo", await setMyGroup(petter, FTR, ftrOslo), true);

      const ids = (await visibleChannels(petter, FTR)).map((c) => c.id);
      expect("F23 Trøndelag forsvinner fra Petters kanalliste", ids.includes(trondelagChannel.id), false);
      expect("F24 Petter leser ikke lenger Trøndelag", (await readMessages(petter, trondelagChannel.id)).length, 0);
      expect("F24 Petter kan ikke skrive i Trøndelag", (await send(petter, trondelagChannel.id, "nei")).id, null);
      expect("F24 direkte oppslag av Trøndelag gir ingenting", await directChannel(petter, trondelagChannel.id), null);
      expect("F25 Oslo dukker opp i Petters kanalliste", ids.includes(osloChannel.id), true);
      expect("F25 Petter leser Oslo", (await readMessages(petter, osloChannel.id)).some((m) => m.id === osloSeed.id), true);
      expect("F25 Petter kan skrive i Oslo", (await send(petter, osloChannel.id, "ny i oslo")).error, null);
      // His other community is untouched by the FTR move.
      const tuIds = (await visibleChannels(petter, TU)).map((c) => c.local_group_id).filter(Boolean);
      expect("F25 Petters TU-lokallag er uendret", tuIds.join(","), await groupId(TU, "TU Trøndelag"));
    }

    // ── G. Indirect leaks ───────────────────────────────────────────────
    {
      expect("G26 siste melding i Trøndelag er skjult for Oslo-medlem", await latestMessage(kristoffer, trondelagChannel.id), null);
      const { count } = await kristoffer
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", trondelagChannel.id);
      expect("G26 meldingsantall i Trøndelag er 0 for Oslo-medlem", count, 0);
      const { data: byBody } = await kristoffer.from("messages").select("id").like("body", `${BODY}: trøndelag%`);
      expect("G26 søk i meldingstekst finner ikke Trøndelag-meldinger", (byBody ?? []).length, 0);

      const { data: byGroup } = await kristoffer.from("channels").select("id").eq("local_group_id", ftrTrondelag);
      expect("G27 kanaloppslag på Trøndelag-gruppen gir ingenting", (byGroup ?? []).length, 0);
      const { data: byName } = await kristoffer.from("channels").select("id").ilike("name", "%Trøndelag%");
      expect("G27 kanaloppslag på navn gir ingenting", (byName ?? []).length, 0);

      expect("G28 kanalmeldinger lager ingen varsler", await notificationCount(), notificationsBefore);

      // Overview and the sidebar both render getGroupedChannels(), which is
      // loadChannels() — the query visibleChannels() reproduces.
      const overview = await visibleChannels(elise, FTR);
      expect("G29 Oversikten viser ingen fremmed lokallagskanal", overview.some((c) => c.local_group_id), false);
      const sidebar = await visibleChannels(kristoffer, FTR);
      expect(
        "G30 sidepanelet viser bare eget lokallag",
        sidebar.filter((c) => c.local_group_id).map((c) => c.id).join(","),
        osloChannel.id,
      );

      // A message in a lokallag channel must not make its author's community
      // profile visible to people outside the group (FTR's member directory is
      // admin-only). Eli has no other FTR content an ordinary member can see,
      // so only the Trøndelag message could have opened it.
      const eliId = await profileId("elironning");
      const { data: eliseSeesEli } = await elise.rpc("can_view_community_profile", { p_community_id: FTR, p_user_id: eliId });
      const { data: kristofferSeesEli } = await kristoffer.rpc("can_view_community_profile", { p_community_id: FTR, p_user_id: eliId });
      expect("G profil: lokallagsmelding åpner ikke profilen for medlem uten lokallag", eliseSeesEli, false);
      expect("G profil: lokallagsmelding åpner ikke profilen for Oslo-medlem", kristofferSeesEli, false);
      const { data: petterSeesEli } = await petter.rpc("can_view_community_profile", { p_community_id: FTR, p_user_id: eliId });
      expect("G profil: Petter (nå Oslo) ser ikke lenger Eli via Trøndelag-meldingen", petterSeesEli, false);
      const { data: authorship } = await elise.rpc("shares_visible_authorship", { other: eliId });
      expect("G profil: shares_visible_authorship teller ikke lokallagsmeldinger", authorship, false);

      // Messages cannot be edited or deleted through the API at all, so the
      // channel boundary cannot be bypassed that way either.
      const upd = await kristoffer.from("messages").update({ body: "endret" }).eq("channel_id", trondelagChannel.id).select();
      expect("G oppdatering av Trøndelag-meldinger gir ingen rader", (upd.data ?? []).length, 0);
      const del = await kristoffer.from("messages").delete().eq("channel_id", trondelagChannel.id).select();
      expect("G sletting av Trøndelag-meldinger gir ingen rader", (del.data ?? []).length, 0);
      const ownUpd = await kristoffer.from("messages").update({ body: "endret" }).eq("channel_id", osloChannel.id).select();
      expect("G meldinger kan fortsatt ikke redigeres via API (uendret regel)", (ownUpd.data ?? []).length, 0);
      const move = await lars.from("channels").update({ local_group_id: null }).eq("id", osloChannel.id).select();
      expect("G admin kan ikke gjøre en lokallagskanal felles", (move.data ?? []).length, 0);
      expect("G Oslo-kanalen er fortsatt knyttet til Oslo", (await channelFor(ftrOslo))[0]?.id, osloChannel.id);
    }

    // ── H. Community-wide channels unchanged ───────────────────────────
    {
      const { data: rows } = await admin.from("channels").select("*").is("local_group_id", null);
      const byId = new Map((rows ?? []).map((row) => [row.id, row]));
      expect("H32 alle fellesskapskanaler fra fixturen finnes", fixtureChannels.every((c) => byId.has(c.id)), true);
      expect("H32 ingen fellesskapskanal er flyttet til lokallag", fixtureChannels.every((c) => byId.get(c.id)?.group_id === c.groupId), true);
      expect("H32 fellesskapskanalene er uendret", fixtureChannels.every((c) => byId.get(c.id)?.purpose === c.purpose && byId.get(c.id)?.read_only === Boolean(c.readOnly)), true);

      const general = fixtureChannels.find((c) => c.communityId === FTR && c.groupId === "generelt" && !c.readOnly)!;
      const { count: total } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("channel_id", general.id);
      for (const [who, client] of [["uten lokallag", elise], ["admin", lars], ["Oslo-medlem", kristoffer]] as const) {
        expect(`H32 ${who} leser hele #${general.name}`, (await readMessages(client, general.id)).length, total);
      }
      const sent = await send(elise, general.id, "fellesskap");
      expect("H32 medlem uten lokallag kan fortsatt skrive i fellesskapskanal", sent.error, null);
      const announcements = fixtureChannels.find((c) => c.communityId === FTR && c.readOnly)!;
      expect("H32 skrivebeskyttet kanal avviser fortsatt vanlige medlemmer", (await send(elise, announcements.id, "nei")).id, null);
    }
  } finally {
    await setMyGroup(petter, FTR, petterOriginal);
    await admin.from("memberships").update({ local_group_id: larsOriginal }).eq("community_id", FTR).eq("user_id", await profileId("larsbror"));
    await admin.from("messages").delete().in("id", createdMessageIds);
    await cleanup();
  }

  expect("opprydding: Petter er tilbake i FTR Trøndelag", await membershipGroup("petter", FTR), ftrTrondelag);
  expect("opprydding: Lars er tilbake uten lokallag", await membershipGroup("larsbror", FTR), null);
  const { count: leftovers } = await admin.from("messages").select("id", { count: "exact", head: true }).like("body", `${BODY}%`);
  expect("opprydding: ingen testmeldinger igjen", leftovers, 0);
  const { count: groupsLeft } = await admin.from("community_local_groups").select("id", { count: "exact", head: true }).like("name", `${GROUP_PREFIX}%`);
  expect("opprydding: ingen testlokallag igjen", groupsLeft, 0);
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(() => {
    if (failures > 0) {
      console.error(`\n✗ ${failures} av ${checks} kontroller feilet.\n`);
      process.exit(1);
    }
    console.log(`✓ ${checks} kontroller av lokallagskanaler passerte`);
  });
