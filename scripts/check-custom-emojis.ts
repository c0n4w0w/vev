/**
 * Checks custom emojis: inline use in messages, community scoping, RLS, and
 * that reactions still behave.
 *
 * Run with `npm run check:custom-emojis` against the local stack after
 * `npm run seed`. Service role only looks up fixtures and cleans up; every
 * behaviour check runs as a real signed-in user under RLS.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";
import { emojiMatchesQuery, emojiToken, insertAtSelection, splitEmojiText } from "@/lib/emoji-text";
import { QUICK_REACTIONS } from "@/lib/emoji/types";
import { MESSAGE_BODY_MAX, messageBodyError } from "@/lib/message-form";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();
let failures = 0;
let checks = 0;

const TR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const UTR = "under-the-rug";
const BUCKET = "community-emoji";

const createdMessageIds: string[] = [];
const createdDirectMessageIds: string[] = [];
const createdReactionIds: string[] = [];
const createdCommentIds: string[] = [];
const createdConversationIds: string[] = [];

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

async function signIn(handle: string): Promise<{ client: SupabaseClient<Database>; id: string }> {
  const { data: profile, error } = await admin.from("profiles").select("id").eq("handle", handle).single();
  if (error) throw error;
  const { data: user } = await admin.auth.admin.getUserById(profile.id);
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.user!.email!,
  });
  if (linkError || !link.properties) throw new Error(`lenke for ${handle}: ${linkError?.message}`);
  const client = createClient<Database>(supabaseUrl(), supabaseAnonKey());
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (verifyError) throw new Error(`innlogging ${handle}: ${verifyError.message}`);
  return { client, id: profile.id };
}

async function catalogue(client: SupabaseClient<Database>, communityId: string) {
  const { data, error } = await client.from("community_emojis").select("*").eq("community_id", communityId);
  if (error) throw error;
  return data;
}

async function main() {
  // ── Pure: tokens and insertion ────────────────────────────────────────
  const known = new Set(["tryggere", "party"]);
  const seg = (body: string) => JSON.stringify(splitEmojiText(body, known));

  expect("vanlig tekst er uendret", seg("Vi møtes klokken 18"), JSON.stringify([{ kind: "text", text: "Vi møtes klokken 18" }]));
  expect(
    "tekst før og etter beholdes",
    seg("Bra :tryggere: jobbet"),
    JSON.stringify([
      { kind: "text", text: "Bra " },
      { kind: "emoji", name: "tryggere" },
      { kind: "text", text: " jobbet" },
    ]),
  );
  expect(
    "flere egne emojier, også inntil hverandre",
    splitEmojiText(":tryggere::party: :party:", known).filter((s) => s.kind === "emoji").length,
    3,
  );
  expect("ukjent emoji blir stående som tekst", seg("Hei :slettet:"), JSON.stringify([{ kind: "text", text: "Hei :slettet:" }]));
  expect(
    "klokkeslett med kolon påvirkes ikke",
    seg("Kl 18:30:45"),
    JSON.stringify([{ kind: "text", text: "Kl 18:30:45" }]),
  );
  expect("ugyldig navn (store bokser) løses ikke", seg(":TRYGGERE:"), JSON.stringify([{ kind: "text", text: ":TRYGGERE:" }]));
  expect(
    "ingen HTML tolkes",
    seg("<img src=x onerror=alert(1)> :party:"),
    JSON.stringify([
      { kind: "text", text: "<img src=x onerror=alert(1)> " },
      { kind: "emoji", name: "party" },
    ]),
  );
  expect("emojiToken", emojiToken("party"), ":party:");
  expect("søk: navn", emojiMatchesQuery("harmreduction", "harm"), true);
  expect("søk: kolon og store bokstaver", emojiMatchesQuery("harmreduction", ":HARM:"), true);
  expect("søk: ingen treff", emojiMatchesQuery("harmreduction", "xyz"), false);

  const mid = insertAtSelection("Bra jobbet ", 11, 11, "🎉");
  expect("standard emoji settes inn ved markøren", mid.value, "Bra jobbet 🎉");
  expect("markøren havner etter emojien", mid.caret, "Bra jobbet 🎉".length);
  expect("innsetting midt i teksten", insertAtSelection("ab", 1, 1, "🎉").value, "a🎉b");
  expect("innsetting erstatter markering", insertAtSelection("abcd", 1, 3, "🎉").value, "a🎉d");
  expect("utkastet beholdes ved innsetting", insertAtSelection("utkast", 0, 0, "x").value.endsWith("utkast"), true);
  expect("hurtigreaksjonene er ❤️ 👍 👏 😂 🎉 🔥", QUICK_REACTIONS.join(" "), "❤️ 👍 👏 😂 🎉 🔥");

  // ── Community scoping and RLS ─────────────────────────────────────────
  const ingrid = await signIn("ingrid"); // member of TR, TU and UTR
  const jonas = await signIn("jonas"); // UTR only
  const kristoffer = await signIn("kristoffer"); // plain member of TR
  const nadia = await signIn("nadia"); // member of TR and TU, like ingrid

  const trCatalogue = await catalogue(ingrid.client, TR);
  const trNames = new Set(trCatalogue.map((row) => row.name));
  expect("medlem ser fellesskapets egne emojier", trNames.has("tryggere") && trNames.has("harmreduction"), true);
  expect("katalogen for TR inneholder ikke TU-emojier", trNames.has("ungdom"), false);
  expect("katalogen for TR inneholder ikke UTR-emojier", trNames.has("rave"), false);
  expect(
    "TU-emoji i en TR-melding blir bare tekst",
    JSON.stringify(splitEmojiText("hei :ungdom:", trNames)),
    JSON.stringify([{ kind: "text", text: "hei :ungdom:" }]),
  );

  const trParty = trCatalogue.find((row) => row.name === "party");
  const utrParty = (await catalogue(ingrid.client, UTR)).find((row) => row.name === "party");
  expect("samme navn i to fellesskap er to emojier", trParty?.id !== utrParty?.id && !!trParty && !!utrParty, true);

  expect("utenforstående ser ingen TR-emojier", (await catalogue(jonas.client, TR)).length, 0);
  expect("utenforstående ser ingen TR-emojier, uansett filter", (await jonas.client.from("community_emojis").select("id").eq("id", trParty!.id)).data?.length, 0);

  const ingridUrl = await ingrid.client.storage.from(BUCKET).createSignedUrl(trParty!.storage_path, 60);
  expect("medlem kan hente emojibildet", !!ingridUrl.data?.signedUrl, true);
  const jonasUrl = await jonas.client.storage.from(BUCKET).createSignedUrl(trParty!.storage_path, 60);
  expect("utenforstående får ikke signert URL", !!jonasUrl.data?.signedUrl, false);
  const jonasDownload = await jonas.client.storage.from(BUCKET).download(trParty!.storage_path);
  expect("utenforstående kan ikke laste ned emojibildet", !!jonasDownload.data, false);

  // ── The stable emoji route: the same lookups it performs, as each user ─
  // downloadCommunityEmoji is: row by (community, id) under RLS, then the
  // object under the storage policy. Reproduced here as the caller's client.
  async function fetchEmoji(client: SupabaseClient<Database>, communityId: string, emojiId: string) {
    const { data: row } = await client
      .from("community_emojis")
      .select("storage_path, content_type")
      .eq("community_id", communityId)
      .eq("id", emojiId)
      .maybeSingle();
    if (!row) return undefined;
    const { data: blob } = await client.storage.from(BUCKET).download(row.storage_path);
    return blob ? { size: blob.size, contentType: row.content_type } : undefined;
  }
  const served = await fetchEmoji(ingrid.client, TR, trParty!.id);
  expect("medlem får bildet fra emoji-ruta", !!served && served.size > 0, true);
  expect("innholdstypen er bildetype", served?.contentType, "image/png");
  expect("utenforstående får ikke bildet", await fetchEmoji(jonas.client, TR, trParty!.id), undefined);
  expect(
    "emoji-id fra feil fellesskap gir ingenting (medlem av begge)",
    await fetchEmoji(ingrid.client, TU, trParty!.id),
    undefined,
  );
  expect(
    "TU-medlem uten TR-medlemskap får ikke TR-emoji med riktig id",
    await fetchEmoji(jonas.client, UTR, trParty!.id),
    undefined,
  );
  expect(
    "ukjent emoji-id gir ingenting",
    await fetchEmoji(ingrid.client, TR, "00000000-0000-0000-0000-000000000000"),
    undefined,
  );
  const origin = process.env.CHECK_APP_ORIGIN ?? "http://localhost:3000";
  const anonymousFetch = await fetch(`${origin}/community/${TR}/emoji/${trParty!.id}`, { redirect: "manual" }).catch(
    () => undefined,
  );
  if (anonymousFetch) {
    expect("innlogget-krav: uten økt gir ruta 404", anonymousFetch.status, 404);
    expect("404 caches ikke", anonymousFetch.headers.get("cache-control"), "no-store");
  } else {
    console.warn("(appen kjører ikke på " + origin + "; HTTP-sjekken hoppet over)");
  }

  // ── Message body limit, shared by channels and DMs ────────────────────
  expect("tom melding avvises", messageBodyError(""), "err.messageEmpty");
  expect("nøyaktig grensen er tillatt", messageBodyError("a".repeat(MESSAGE_BODY_MAX)), undefined);
  expect("over grensen avvises", messageBodyError("a".repeat(MESSAGE_BODY_MAX + 1)), "err.messageTooLong");
  expect(
    "emoji-tokener teller som vanlig tekst",
    messageBodyError(":party:".repeat(Math.floor(MESSAGE_BODY_MAX / 7) + 1)),
    "err.messageTooLong",
  );
  expect("grensen er 4000", MESSAGE_BODY_MAX, 4000);

  // Administration is unchanged: a plain member can neither add nor delete.
  const memberInsert = await kristoffer.client.from("community_emojis").insert({
    community_id: TR,
    name: "check-tmp",
    storage_path: `${TR}/check-tmp.png`,
    content_type: "image/png",
    byte_size: 10,
  });
  expect("vanlig medlem kan ikke lage emoji", !!memberInsert.error, true);
  const memberDelete = await kristoffer.client.from("community_emojis").delete().eq("id", trParty!.id).select();
  expect("vanlig medlem kan ikke slette emoji", memberDelete.data?.length ?? 0, 0);
  expect("emojien finnes fortsatt", (await catalogue(kristoffer.client, TR)).some((row) => row.id === trParty!.id), true);

  // ── Messages: Unicode, tokens and plain text survive save and read ────
  const bodies = [
    "Bra jobbet 🎉 👍",
    "Dette var bra :party: og :tryggere: takk",
    "Vi møtes klokken 18",
    "Ukjent :finnesikke: forblir tekst",
  ];
  for (const body of bodies) {
    const { data, error } = await ingrid.client
      .from("messages")
      .insert({ channel_id: `${TR}--generelt`, body })
      .select("*")
      .single();
    expect(`melding lagres: ${body}`, error?.message ?? "ok", "ok");
    if (data) {
      createdMessageIds.push(data.id);
      const { data: read } = await ingrid.client.from("messages").select("body").eq("id", data.id).single();
      expect(`melding leses uendret: ${body}`, read?.body, body);
    }
  }
  const outsiderMessage = await jonas.client
    .from("messages")
    .insert({ channel_id: `${TR}--generelt`, body: ":party:" })
    .select();
  expect("utenforstående kan ikke skrive i TR-kanal", !!outsiderMessage.error, true);
  const outsiderRead = await jonas.client.from("messages").select("id").in("id", createdMessageIds);
  expect("utenforstående kan ikke lese TR-meldinger med emojier", outsiderRead.data?.length ?? 0, 0);

  // ── Comments: same tokens, same catalogue, same limits ────────────────
  const { data: commentPost } = await admin.from("posts").select("id").eq("community_id", TR).eq("pinned", true).single();
  async function addComment(client: SupabaseClient<Database>, body: string) {
    const { data, error } = await client
      .from("comments")
      .insert({ post_id: commentPost!.id, body })
      .select("id, body")
      .maybeSingle();
    if (data) createdCommentIds.push(data.id);
    return { data, error };
  }
  for (const body of ["Takk 🎉 for jobben", "Takk :party: dette blir bra", "🎉", ":party:", "Ukjent :finnesikke: her"]) {
    const saved = await addComment(kristoffer.client, body);
    expect(`kommentar lagres: ${body}`, saved.error?.message ?? "ok", "ok");
    if (saved.data) {
      const { data: read } = await kristoffer.client.from("comments").select("body").eq("id", saved.data.id).single();
      expect(`kommentar leses uendret: ${body}`, read?.body, body);
    }
  }
  expect("kun mellomrom avvises som kommentar", !!(await addComment(kristoffer.client, "   ")).error, true);
  expect("kommentar over 4000 tegn avvises", !!(await addComment(kristoffer.client, ":party:".repeat(573))).error, true);
  expect(
    "kommentar på nøyaktig 4000 tegn er tillatt",
    (await addComment(kristoffer.client, "x".repeat(4000))).error?.message ?? "ok",
    "ok",
  );
  const commentNames = new Set(trNames);
  const commentSegments = splitEmojiText("Takk :party: og :ungdom: og :rave:", commentNames);
  expect(
    "TR-emoji løses i TR-kommentar",
    commentSegments.filter((seg) => seg.kind === "emoji").map((seg) => (seg as { name: string }).name).join(","),
    "party",
  );
  expect(
    "TU- og UTR-emoji forblir tekst i TR-kommentar",
    commentSegments.some((seg) => seg.kind === "text" && seg.text.includes(":ungdom:") && seg.text.includes(":rave:")),
    true,
  );
  const outsiderComment = await jonas.client.from("comments").select("id").eq("post_id", commentPost!.id);
  expect("utenforstående leser ikke TR-kommentarer med emojier", outsiderComment.data?.length ?? 0, 0);
  expect("utenforstående får ikke emojiruta for TR", await fetchEmoji(jonas.client, TR, trParty!.id), undefined);

  // ── DM: the community's own catalogue only ────────────────────────────
  // ingrid and nadia share TR *and* TU; a DM inside TR must use TR's emojis only.
  const started = await ingrid.client.rpc("start_direct_conversation", {
    p_community_id: TR,
    p_recipient_id: nadia.id,
  });
  if (started.data) createdConversationIds.push(started.data);
  const conversation = started.data ? { id: started.data, community_id: TR } : undefined;
  expect("DM-samtale kan opprettes for testen", started.error?.message ?? "ok", "ok");
  if (conversation) {
    const dmCatalogue = await catalogue(ingrid.client, conversation.community_id);
    expect(
      "DM bruker bare fellesskapets egne emojier",
      dmCatalogue.every((row) => row.community_id === conversation.community_id),
      true,
    );
    const dmNames = new Set(dmCatalogue.map((row) => row.name));
    expect(
      "TU-emoji (delt medlemskap) er utilgjengelig i TR-DM",
      splitEmojiText(":ungdom:", dmNames).every((s) => s.kind === "text"),
      true,
    );
    const body = "Hei 🎉 :party:";
    const { data: dm, error } = await ingrid.client
      .from("direct_messages")
      .insert({ conversation_id: conversation.id, body })
      .select("*")
      .single();
    expect("DM med emoji lagres", error?.message ?? "ok", "ok");
    if (dm) {
      createdDirectMessageIds.push(dm.id);
      expect("DM leses uendret", dm.body, body);
    }
    const tooLong = await ingrid.client
      .from("direct_messages")
      .insert({ conversation_id: conversation.id, body: "🎉".repeat(4001) })
      .select();
    expect("DM over 4000 tegn avvises", !!tooLong.error || (tooLong.data?.length ?? 0) === 0, true);
    if (tooLong.data?.[0]) createdDirectMessageIds.push(tooLong.data[0].id);
    const nadiaRead = await nadia.client.from("direct_messages").select("body").eq("conversation_id", conversation.id);
    expect("mottakeren leser DM-en med emoji uendret", nadiaRead.data?.some((row) => row.body === body), true);
    const outsiderDm = await jonas.client.from("direct_messages").select("id").eq("conversation_id", conversation.id);
    expect("utenforstående leser ikke DM-en", outsiderDm.data?.length ?? 0, 0);
  }

  // ── Reactions still work, and still refuse a foreign emoji ────────────
  // A community-wide post, chosen deterministically. `limit(1)` alone returned
  // whichever row the heap held first, which after one run could be a lokallag
  // post Ingrid (moderator, no lokallag) correctly cannot read.
  const { data: post } = await admin
    .from("posts")
    .select("id")
    .eq("community_id", TR)
    .is("local_group_id", null)
    .is("subgroup_id", null)
    .order("created_at", { ascending: false })
    .order("id")
    .limit(1)
    .single();
  const ownReaction = await ingrid.client
    .from("post_reactions")
    .insert({ post_id: post!.id, user_id: ingrid.id, emoji_id: trParty!.id })
    .select("id")
    .single();
  expect("reaksjon med fellesskapets emoji virker", ownReaction.error?.message ?? "ok", "ok");
  if (ownReaction.data) createdReactionIds.push(ownReaction.data.id);
  const foreignEmoji = (await catalogue(ingrid.client, TU))[0];
  const foreignReaction = await ingrid.client
    .from("post_reactions")
    .insert({ post_id: post!.id, user_id: ingrid.id, emoji_id: foreignEmoji.id })
    .select("id");
  expect("reaksjon med emoji fra et annet fellesskap avvises", !!foreignReaction.error, true);
  if (foreignReaction.data?.[0]) createdReactionIds.push(foreignReaction.data[0].id);
  const unicodeReaction = await ingrid.client
    .from("post_reactions")
    .insert({ post_id: post!.id, user_id: ingrid.id, emoji: "🎉" })
    .select("id")
    .single();
  expect("vanlig emoji-reaksjon virker", unicodeReaction.error?.message ?? "ok", "ok");
  if (unicodeReaction.data) createdReactionIds.push(unicodeReaction.data.id);

}

async function cleanup() {
  if (createdCommentIds.length) await admin.from("comments").delete().in("id", createdCommentIds);
  if (createdReactionIds.length) await admin.from("post_reactions").delete().in("id", createdReactionIds);
  if (createdMessageIds.length) await admin.from("messages").delete().in("id", createdMessageIds);
  // Sending a DM notifies the recipient; deleting the conversation does not
  // take that notification with it, and check:notifications counts rows.
  for (const id of createdConversationIds) {
    await admin.from("notifications").delete().like("href", `%/messages/${id}`);
  }
  if (createdConversationIds.length) await admin.from("direct_conversations").delete().in("id", createdConversationIds);
  if (createdDirectMessageIds.length) await admin.from("direct_messages").delete().in("id", createdDirectMessageIds);
}

main()
  .catch((error) => {
    failures += 1;
    console.error(error);
  })
  .finally(async () => {
    await cleanup();
    if (failures > 0) {
      console.error(`\n${failures} av ${checks} sjekker feilet.`);
      process.exit(1);
    }
    console.log(`✓ ${checks} sjekker av egne emojier bestått`);
  });
