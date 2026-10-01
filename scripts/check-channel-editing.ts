/**
 * Checks `set_channel_details()`: who may change a channel's display name and
 * description, what is rejected, and that id, community and messages stay put.
 *
 * Run with `npm run check:community-about` against the local stack after
 * `npm run seed`. Every permission check goes through ordinary anon-key
 * clients signed in as fixture accounts, calling exactly what
 * `updateChannelDetailsAction` calls — `set_channel_details()` — so a passing
 * run means the *database* refuses, not that the page hides a pencil. The
 * service role is only used to read state back, flip one membership to
 * inactive, and restore the seeded text afterwards.
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

const UTR = "under-the-rug";
const TR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";

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

/** The handle of some active member with exactly this role in the community. */
async function handleWithRole(communityId: string, role: "moderator" | "member"): Promise<string> {
  const { data, error } = await admin
    .from("memberships")
    .select("profiles!memberships_user_id_fkey(handle)")
    .eq("community_id", communityId)
    .eq("role", role)
    .eq("status", "active")
    .limit(1)
    .single();
  if (error) throw error;
  return (data as unknown as { profiles: { handle: string } }).profiles.handle;
}

async function stored(channelId: string) {
  const { data, error } = await admin.from("channels").select("*").eq("id", channelId).single();
  if (error) throw error;
  return data;
}

async function setDetails(client: Client, communityId: string, channelId: string, name: string, purpose: string) {
  const { data, error } = await client.rpc("set_channel_details", {
    p_community_id: communityId,
    p_channel_id: channelId,
    p_name: name,
    p_purpose: purpose,
  });
  return { row: data?.[0] ?? null, error };
}

async function messageCount(channelId: string) {
  const { count, error } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", channelId);
  if (error) throw error;
  return count ?? 0;
}

async function main() {
  const general = new Map(
    [UTR, TR, TU].map((communityId) => {
      const channel = fixtureChannels.find((c) => c.communityId === communityId && c.name === "generelt");
      if (!channel) throw new Error(`fant ikke #generelt i ${communityId}`);
      return [communityId, channel] as const;
    }),
  );
  const admins: [string, string][] = [
    [UTR, "octavio"],
    [TR, "larsbror"],
    [TU, "emmamortensen"],
  ];
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const adminClients = new Map<string, Client>();
  const moderators = new Map<string, Client>();
  const members = new Map<string, Client>();
  for (const [communityId, handle] of admins) {
    adminClients.set(communityId, await signIn(handle));
    moderators.set(communityId, await signIn(await handleWithRole(communityId, "moderator")));
    members.set(communityId, await signIn(await handleWithRole(communityId, "member")));
  }

  const ch = general.get(UTR)!;
  const original = await stored(ch.id);
  const messagesBefore = await messageCount(ch.id);

  try {
    // ── 1–3, 14, 15: an admin changes both fields; id and community stay ──
    {
      const result = await setDetails(adminClients.get(UTR)!, UTR, ch.id, "  prat  ", "  Ny beskrivelse  ");
      expect("admin kan oppdatere navn (trimmet)", result.row?.name, "prat");
      expect("admin kan oppdatere beskrivelse (trimmet)", result.row?.purpose, "Ny beskrivelse");
      const row = await stored(ch.id);
      expect("navn er lagret", row.name, "prat");
      expect("beskrivelse er lagret", row.purpose, "Ny beskrivelse");
      expect("kanal-id er uendret", row.id, ch.id);
      expect("kanalen er fortsatt i samme fellesskap", row.community_id, UTR);
      expect("gruppe, posisjon og skrivebeskyttelse er uendret", `${row.group_id}/${row.position}/${row.read_only}`, `${original.group_id}/${original.position}/${original.read_only}`);
      expect("meldingshistorikken hører fortsatt til kanalen", await messageCount(ch.id), messagesBefore);

      // sidebar query: what the app reads through an ordinary member session
      const { data: seen } = await members.get(UTR)!.from("channels").select("id, name").eq("community_id", UTR).eq("id", ch.id).single();
      expect("sidepanel-spørringen returnerer det nye navnet", seen?.name, "prat");
    }

    // ── 12: unchanged values are safe ──
    {
      const result = await setDetails(adminClients.get(UTR)!, UTR, ch.id, "prat", "Ny beskrivelse");
      expect("uendrede verdier godtas", result.row?.name, "prat");
      expect("uendrede verdier endrer ikke beskrivelsen", (await stored(ch.id)).purpose, "Ny beskrivelse");
    }

    // ── 8: a channel cannot be moved: wrong community id finds no row ──
    {
      const result = await setDetails(adminClients.get(TR)!, TR, ch.id, "flyttet", "flyttet");
      expect("kanal kan ikke endres via et annet fellesskap", result.row, null);
      expect("kanalen er uendret etter forsøk på flytting", (await stored(ch.id)).name, "prat");
      const direct = await adminClients.get(UTR)!.from("channels").update({ community_id: TR }).eq("id", ch.id).select();
      expect("direkte tabellskriving (flytting) gir ingen rader", (direct.data ?? []).length, 0);
      expect("kanalen ligger fortsatt i opprinnelig fellesskap", (await stored(ch.id)).community_id, UTR);
    }

    // ── 9–11: validation ──
    {
      const client = adminClients.get(UTR)!;
      for (const [label, name, purpose] of [
        ["tomt navn avvises", "", "x"],
        ["navn med bare mellomrom avvises", "   ", "x"],
        ["navn med linjeskift avvises", "a\nb", "x"],
        ["for langt navn avvises", "n".repeat(41), "x"],
        ["for lang beskrivelse avvises", "ok", "d".repeat(201)],
        ["beskrivelse med linjeskift avvises", "ok", "a\nb"],
      ] as const) {
        const result = await setDetails(client, UTR, ch.id, name, purpose);
        expect(label, result.row, null);
      }
      const row = await stored(ch.id);
      expect("ingenting endret etter avviste forsøk", `${row.name}|${row.purpose}`, "prat|Ny beskrivelse");
      const exact = await setDetails(client, UTR, ch.id, "n".repeat(40), "d".repeat(200));
      expect("nøyaktig grense (40/200) godtas", exact.row?.name.length, 40);
      const emptyPurpose = await setDetails(client, UTR, ch.id, "prat", "");
      expect("tom beskrivelse er tillatt", emptyPurpose.row?.purpose, "");
    }

    // ── 4–6: everyone who must not write ──
    {
      const before = await stored(ch.id);
      const attempts: [string, Client][] = [
        ["medlem", members.get(UTR)!],
        ["moderator", moderators.get(UTR)!],
        ["admin i annet fellesskap", adminClients.get(TR)!],
        ["uautentisert", anon],
      ];
      for (const [who, client] of attempts) {
        const result = await setDetails(client, UTR, ch.id, "uautorisert", "uautorisert");
        expect(`${who} kan ikke oppdatere kanalen`, result.row, null);
      }
      const direct = await members.get(UTR)!.from("channels").update({ name: "direkte" }).eq("id", ch.id).select();
      expect("direkte tabellskriving som medlem gir ingen rader", (direct.data ?? []).length, 0);
      const after = await stored(ch.id);
      expect("kanalen er uendret etter uautoriserte forsøk", `${after.name}|${after.purpose}`, `${before.name}|${before.purpose}`);
    }

    // ── 7: an inactive former admin cannot write ──
    {
      const { data: row, error } = await admin
        .from("memberships")
        .select("id, status")
        .eq("community_id", UTR)
        .eq("user_id", await profileId("octavio"))
        .single();
      if (error) throw error;
      try {
        await admin.from("memberships").update({ status: "invited" }).eq("id", row.id);
        const result = await setDetails(adminClients.get(UTR)!, UTR, ch.id, "inaktiv", "inaktiv");
        expect("inaktiv tidligere admin kan ikke oppdatere kanalen", result.row, null);
      } finally {
        await admin.from("memberships").update({ status: row.status }).eq("id", row.id);
      }
    }

    expect("antall meldinger er uendret etter alle forsøk", await messageCount(ch.id), messagesBefore);
  } finally {
    await admin.from("channels").update({ name: original.name, purpose: original.purpose, community_id: original.community_id }).eq("id", ch.id);
  }
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
    console.log(`✓ ${checks} kontroller av kanalredigering passerte`);
  });
