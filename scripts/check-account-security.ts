/**
 * Checks passwords and email changes: that both sign-in methods reach the
 * same account, that a password is only ever one its owner chose and only its
 * owner can replace, that an address can be moved without the old inbox but
 * never without the password, the new inbox and the owner's own session, that
 * no membership is activated before the account has a password, and that
 * guessing is slowed.
 *
 * Run with `npm run check:account-security` against the local stack. People
 * are made the real way — a public request, approved by the community's own
 * administrator, the approval's sign-in token redeemed — and every credential
 * change goes through Supabase Auth exactly as the app does it. The rules
 * under test live in the database, so each "must not" here is tried against
 * the Auth API and the data API directly, the way someone holding a stolen
 * session would, not through TING's forms.
 *
 * The service role reads state back, ages two timestamps (so a day-old
 * password does not take a day to test), calls the two counting functions the
 * server calls, and removes what this run made. One thing needs the database
 * itself: making a session's proof old, which is done through the local
 * stack's own container. No password, token or link is printed. Emails are
 * read from the local mail catcher; nothing leaves the machine.
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { clientIpFrom } from "@/lib/client-ip";
import { mintEmailSignInLink } from "@/lib/email-sign-in-link";
import { EMAIL_LOGO } from "@/lib/email/invitation";
import {
  checkNewPassword,
  EMAIL_CHANGE_COOLDOWN_HOURS,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();
const FTR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const UTR = "under-the-rug";
const MAILPIT = process.env.LOCAL_MAIL_CATCHER_URL ?? "http://127.0.0.1:54324";
const SITE = "http://localhost:3000";
const SENDER = "TING <ikke-svar@join-ting.no>";

let failures = 0;
let checks = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

type Client = SupabaseClient<Database>;
const fresh = (): Client =>
  createClient<Database>(supabaseUrl(), supabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Auth sends one email per account per second locally; stay clear of that. */
const breathe = () => pause(1200);

const started = new Date().toISOString();
const accounts = new Set<string>();
const emails: string[] = [];
const address = (label: string) => {
  const email = `check.konto.${label}.${randomUUID().slice(0, 8)}@demo.join-ting.no`;
  emails.push(email);
  return email;
};
/** Throwaway passphrases, different every run. */
const passphrase = (label: string) => `${label} ${randomUUID()}`;

async function signInHandle(handle: string): Promise<Client> {
  const { data: profile } = await admin.from("profiles").select("id").eq("handle", handle).single();
  const { data } = await admin.auth.admin.getUserById(profile!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: data.user!.email! });
  const client = fresh();
  await client.auth.verifyOtp({ type: "email", token_hash: link!.properties!.hashed_token });
  return client;
}

/** Signs in the way an emailed sign-in link does. */
async function signInByLink(email: string): Promise<Client> {
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const client = fresh();
  const { error } = await client.auth.verifyOtp({ type: "email", token_hash: link!.properties!.hashed_token });
  if (error) throw new Error(`lenkeinnlogging feilet: ${error.code}`);
  return client;
}

async function signInByPassword(email: string, password: string) {
  const client = fresh();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  return { client, userId: data.user?.id, code: error?.code ?? null };
}

const slugOf = async (id: string) => (await admin.from("communities").select("slug").eq("id", id).single()).data!.slug;

/** A public request, approved by that community's administrator. */
async function approve(email: string, approver: Client, communityId: string, name: string) {
  const asked = await fresh().rpc("request_community_access", {
    p_slug: await slugOf(communityId),
    p_email: email,
    p_display_name: name,
  });
  if (asked.data !== true) throw new Error(`forespørsel feilet: ${asked.error?.message}`);
  const { data: request } = await admin
    .from("access_requests").select("id").eq("community_id", communityId).eq("email", email).eq("status", "pending").single();
  const { data: approved } = await approver.rpc("approve_access_request", { p_request_id: request!.id });
  return approved?.[0];
}

const accept = async (client: Client, token: string) =>
  ((await client.rpc("accept_invitation_token", { p_token: token })).data ?? [])[0] as
    | { ok: boolean; community_id: string | null; reason: string }
    | undefined;

/**
 * A new member, made the real way: request → approval → the approval email's
 * link → a password → accepted. `refusal` is what the invitation said before
 * the password existed.
 */
async function newMember(label: string, approver: Client, communityId = TU) {
  const email = address(label);
  const approved = await approve(email, approver, communityId, `Konto ${label}`);
  const invitation = approved!.token as string;
  const minted = await mintEmailSignInLink(admin, { email, communityId });
  const client = fresh();
  const signedIn = await client.auth.verifyOtp({ type: "email", token_hash: minted!.tokenHash });
  const id = signedIn.data.user!.id;
  accounts.add(id);
  const refusal = (await accept(client, invitation))?.reason;
  const password = passphrase(label);
  const created = await client.auth.updateUser({ password });
  if (created.error) throw new Error(`passord feilet: ${created.error.code}`);
  const joined = (await accept(client, invitation))?.reason;
  return { email, id, client, invitation, password, refusal, joined };
}

/** The local stack's database, for the one thing no API offers. */
const sql = (statement: string) =>
  execFileSync(
    "docker",
    ["exec", "-i", process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_vev", "psql", "-U", "supabase_admin", "-d", "postgres", "-Atc", statement],
    { stdio: ["ignore", "pipe", "pipe"] },
  ).toString().trim();

/** The refusal a statement ends in, or "" when the database let it through. */
function sqlRefusal(statement: string): string {
  try {
    execFileSync(
      "docker",
      ["exec", "-i", process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_vev", "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", statement],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    return "";
  } catch (error) {
    return String((error as { stderr?: Buffer }).stderr ?? error);
  }
}

/**
 * Makes a session what a stolen one usually is: signed in a while ago. Its
 * proof of sign-in is aged in the database and the session refreshed, so the
 * token it carries from then on honestly says so.
 */
async function ageSession(client: Client, hours: number) {
  const { data } = await client.auth.getSession();
  const sessionId = JSON.parse(Buffer.from(data.session!.access_token.split(".")[1], "base64url").toString()).session_id;
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) throw new Error("ukjent sesjon");
  sql(`update auth.mfa_amr_claims set created_at = now() - interval '${hours} hours', updated_at = now() - interval '${hours} hours' where session_id = '${sessionId}'`);
  const refreshed = await client.auth.refreshSession();
  if (refreshed.error) throw new Error(`fornyelse feilet: ${refreshed.error.code}`);
}

const throttleKeys = new Set<string>();
/** What the server does before it checks a password: seconds to wait, or 0 and the try is counted. */
async function beginAttempt(email: string, ip = ""): Promise<number> {
  const { data: key } = await admin.rpc("password_throttle_key", { p_email: email });
  throttleKeys.add(key as string);
  if (ip) throttleKeys.add(`password:ip:${ip}`);
  const { data, error } = await admin.rpc("begin_password_attempt", { p_email: email, p_ip: ip });
  if (error) throw new Error(`teller feilet: ${error.message}`);
  return data as number;
}

type SecurityRow = Database["public"]["Tables"]["account_security"]["Row"];
const security = async (userId: string): Promise<SecurityRow | null> =>
  (await admin.from("account_security").select("*").eq("user_id", userId).maybeSingle()).data;
const authUser = async (id: string) => (await admin.auth.admin.getUserById(id)).data.user;
/** Everything a community holds about a person, as one comparable string. */
async function footprint(userId: string) {
  const [memberships, profiles, dms] = await Promise.all([
    admin.from("memberships").select("community_id, status, role, local_group_id, onboarding_dismissed_at, joined_at").eq("user_id", userId).order("community_id"),
    admin.from("community_profiles").select("community_id, display_name, bio, avatar_path").eq("user_id", userId).order("community_id"),
    admin.from("direct_conversations").select("id").or(`participant_one_id.eq.${userId},participant_two_id.eq.${userId}`).order("id"),
  ]);
  return JSON.stringify([memberships.data, profiles.data, dms.data]);
}
/** A password that is old enough to authorise an email change, without waiting a day. */
const agePassword = (userId: string) =>
  admin.from("account_security").update({ password_set_at: new Date(Date.now() - 25 * 3_600_000).toISOString() }).eq("user_id", userId);

type Mail = { subject: string; from: string; html: string };
async function mailsTo(email: string): Promise<Mail[]> {
  await pause(700);
  const found = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).then((r) => r.json());
  const out: Mail[] = [];
  for (const summary of (found.messages ?? []) as { ID: string; Subject: string; From: { Name: string; Address: string } }[]) {
    const full = await fetch(`${MAILPIT}/api/v1/message/${summary.ID}`).then((r) => r.json());
    out.push({ subject: summary.Subject, from: `${summary.From.Name} <${summary.From.Address}>`, html: full.HTML as string });
  }
  return out;
}
const links = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replace(/&amp;/g, "&"));
const section = (toml: string, name: string) => toml.split(`[${name}]`)[1]?.split("\n[")[0] ?? "";

async function main() {
  // ── 0. The password rule, the settings it leans on, and whose address a request has ──
  expect("regel: elleve tegn er for kort", checkNewPassword("a".repeat(11), "a".repeat(11)), "too-short");
  expect("regel: tolv tegn holder, uten krav til tegntyper", checkNewPassword("aaaaaaaaaaaa", "aaaaaaaaaaaa"), null);
  expect("regel: en passfrase med mellomrom", checkNewPassword("fire ord er nok her", "fire ord er nok her"), null);
  expect("regel: æøå telles som tegn, ikke byte", checkNewPassword("æøåæøåæøåæøå", "æøåæøåæøåæøå"), null);
  expect("regel: 72 byte går", checkNewPassword("a".repeat(72), "a".repeat(72)), null);
  expect("regel: 73 byte er for langt", checkNewPassword("a".repeat(73), "a".repeat(73)), "too-long");
  expect("regel: 37 × «æ» er 74 byte", checkNewPassword("æ".repeat(37), "æ".repeat(37)), "too-long");
  expect("regel: ulike felt", checkNewPassword("en lang passfrase", "en lang passfrasE"), "mismatch");
  expect("regel: ingenting trimmes", checkNewPassword(" tolv tegn ok ", " tolv tegn ok"), "mismatch");

  const toml = readFileSync("supabase/config.toml", "utf8");
  const auth = section(toml, "auth");
  const authEmail = section(toml, "auth.email");
  expect("config: minste passordlengde følger appen", auth.includes(`minimum_password_length = ${PASSWORD_MIN_LENGTH}`), true);
  expect("config: ingen krav til tegntyper", auth.includes('password_requirements = ""'), true);
  expect("config: e-post må bekreftes", authEmail.includes("enable_confirmations = true"), true);
  expect("config: gammel sesjon kan ikke sette passord", authEmail.includes("secure_password_change = true"), true);
  expect("config: gammel innboks kreves ikke for e-postbytte", authEmail.includes("double_confirm_changes = false"), true);
  const external = [...toml.matchAll(/\[auth\.(external|third_party|web3)\.([a-z0-9_]+)\]([^[]*)/g)];
  expect("config: det finnes leverandørseksjoner å kontrollere", external.length > 0, true);
  expect(
    "config: ingen sosial eller ekstern innlogging er slått på",
    external.filter((match) => /^\s*enabled\s*=\s*true/m.test(match[3])).map((match) => match[2]).join(","),
    "",
  );
  const cooldown = await admin.rpc("email_change_cooldown");
  expect("regel: ventetiden i appen er databasens", cooldown.data, `${EMAIL_CHANGE_COOLDOWN_HOURS}:00:00`);
  expect("regel: øvre grense er Auths", PASSWORD_MAX_BYTES, 72);

  // The address a request came from is the one the deployment's own proxy
  // wrote — counted from the right — and never one the caller sent.
  expect("adresse: ingen proxy er til å stole på → ukjent", clientIpFrom("203.0.113.5", 0), undefined);
  expect("adresse: ingen header → ukjent", clientIpFrom(null, 1), undefined);
  expect("adresse: én proxy, én verdi", clientIpFrom("203.0.113.5", 1), "203.0.113.5");
  expect("adresse: det klienten selv sendte, leses ikke", clientIpFrom("10.0.0.1, 198.51.100.9, 203.0.113.5", 1), "203.0.113.5");
  expect("adresse: forfalsket verdi alene i spissen hjelper ikke", clientIpFrom("127.0.0.1,203.0.113.5", 1), "203.0.113.5");
  expect("adresse: to proxyer → nest siste", clientIpFrom("10.0.0.1, 203.0.113.5, 192.0.2.10", 2), "203.0.113.5");
  expect("adresse: færre ledd enn proxyer → ukjent", clientIpFrom("203.0.113.5", 2), undefined);
  expect("adresse: ikke en adresse → ukjent", clientIpFrom("ikke-en-adresse", 1), undefined);
  expect("adresse: tomt siste ledd → ukjent", clientIpFrom("203.0.113.5, ", 1), undefined);
  expect("adresse: IPv6 telles per /64", clientIpFrom("2001:db8:1:2:aaaa:bbbb:cccc:dddd", 1), "2001:db8:1:2::/64");
  expect("adresse: samme /64, annen vert, samme nøkkel", clientIpFrom("2001:db8:1:2::1", 1), "2001:db8:1:2::/64");
  expect("adresse: IPv4 skrevet som IPv6", clientIpFrom("::ffff:203.0.113.5", 1), "203.0.113.5");

  const emma = await signInHandle("emmamortensen"); // TU admin
  const emmaProfile = (await admin.from("profiles").select("id, email").eq("handle", "emmamortensen").single()).data!;

  // ── 1. New member: no membership before a password ──────────────────────
  const nyEmail = address("ny");
  const nyApproved = await approve(nyEmail, emma, TU, "Konto ny");
  expect("ny: godkjenning uten konto gir invitasjon", nyApproved?.outcome, "invited");
  const nyInvitation = nyApproved!.token as string;
  const nyLink = await mintEmailSignInLink(admin, { email: nyEmail, communityId: TU });
  const ny = { email: nyEmail, client: fresh(), id: "" };
  ny.id = (await ny.client.auth.verifyOtp({ type: "email", token_hash: nyLink!.tokenHash })).data.user!.id;
  accounts.add(ny.id);
  expect("ny: kontoen har ikke noe passord, heller ikke et tilfeldig", (await security(ny.id))?.password_set_at ?? null, null);

  // Signed in, invitation in hand, no password: every way in is tried.
  const refused = await accept(ny.client, nyInvitation);
  expect("ny: invitasjonen aktiverer ikke uten passord", `${refused?.ok}:${refused?.reason}`, "false:password-required");
  expect("ny: det er notert at kontoen skylder et passord", Boolean((await security(ny.id))?.password_setup_required_at), true);
  expect("ny: invitasjonen er ikke brukt opp av forsøket", ((await fresh().rpc("invitation_preview", { p_token: nyInvitation })).data ?? []).length, 1);
  expect("ny: ingen medlemskapsrad", (await admin.from("memberships").select("id").eq("user_id", ny.id)).data?.length, 0);
  expect("ny: ikke medlem", (await ny.client.rpc("is_member", { cid: TU })).data, false);
  expect("ny: ser ingen TU-kanaler", ((await ny.client.from("channels").select("id").eq("community_id", TU)).data ?? []).length, 0);
  expect("ny: ser ingen TU-innlegg", ((await ny.client.from("posts").select("id").eq("community_id", TU)).data ?? []).length, 0);
  expect("ny: ser ingen TU-medlemmer", ((await ny.client.from("memberships").select("id").eq("community_id", TU)).data ?? []).length, 0);
  // The logic behind the check is not callable on its own.
  const inner = await ny.client.rpc("accept_invitation_token_for_account", { p_token: nyInvitation });
  expect("ny: funksjonen bak kontrollen kan ikke kalles direkte", Boolean(inner.error), true);
  const planted = await ny.client.from("memberships").insert({ user_id: ny.id, community_id: TU, role: "member", status: "active" }).select();
  expect("ny: kan ikke skrive et medlemskap selv", (planted.data ?? []).length, 0);
  const forgedRow = await ny.client.from("account_security").update({ password_set_at: new Date().toISOString() }).eq("user_id", ny.id).select();
  expect("ny: kan ikke late som passordet finnes", (forgedRow.data ?? []).length, 0);
  expect("ny: fortsatt ingen medlemskap etter forsøkene", (await admin.from("memberships").select("id").eq("user_id", ny.id)).data?.length, 0);
  expect("ny: ikke-autentisert kan ikke godta", ((await fresh().rpc("accept_invitation_token", { p_token: nyInvitation })).data ?? []).some((row) => row.ok), false);

  const short = await ny.client.auth.updateUser({ password: "elleve tegn" });
  expect("ny: Auth avviser et kort passord", short.error?.code, "weak_password");
  const long = await ny.client.auth.updateUser({ password: "a".repeat(73) });
  expect("ny: Auth avviser over 72 tegn", Boolean(long.error), true);
  expect("ny: avviste passord teller ikke", (await accept(ny.client, nyInvitation))?.reason, "password-required");

  const nyPassword = passphrase("ny");
  const created = await ny.client.auth.updateUser({ password: nyPassword });
  expect("ny: første passord opprettes uten at noe gammelt kreves", created.error, null);
  expect("ny: samme konto-id", created.data.user?.id, ny.id);
  expect("ny: kontoen har nå et passord", Boolean((await security(ny.id))?.password_set_at), true);
  const joined = await accept(ny.client, nyInvitation);
  expect("ny: nå godtas invitasjonen", `${joined?.ok}:${joined?.reason}`, "true:joined");
  expect("ny: aktivt TU-medlem", (await ny.client.rpc("is_member", { cid: TU })).data, true);
  expect("ny: velkomstkortet vises", (await ny.client.rpc("my_onboarding_visible", { p_community_id: TU })).data, true);
  expect("ny: fortsatt nøyaktig én konto for adressen", (await admin.from("profiles").select("id").eq("email", ny.email)).data?.length, 1);
  const before = await footprint(ny.id);
  const changedMail = (await mailsTo(ny.email)).filter((mail) => mail.subject === "Passordet ditt på TING er endret");
  expect("ny: varsel om passord sendt til kontoen", changedMail.length, 1);
  expect("ny: varselet kommer fra TING", changedMail[0]?.from, SENDER);
  expect("ny: varselet inneholder ikke passordet", changedMail[0]?.html.includes(nyPassword), false);

  await ny.client.auth.signOut();
  expect("ny: utlogget sesjon kan ikke fornyes", Boolean((await ny.client.auth.refreshSession()).error), true);
  const withPassword = await signInByPassword(ny.email, nyPassword);
  expect("ny: logger inn med e-post og passord", withPassword.code, null);
  expect("ny: det er samme konto", withPassword.userId, ny.id);
  expect("ny: passordsesjonen er medlem av TU", (await withPassword.client.rpc("is_member", { cid: TU })).data, true);
  expect("ny: ser TU-kanaler", ((await withPassword.client.from("channels").select("id").eq("community_id", TU)).data ?? []).length > 0, true);
  expect("ny: innlogging gir ikke medlemskap i FTR", (await withPassword.client.rpc("is_member", { cid: FTR })).data, false);
  expect("ny: ser ingen FTR-kanaler", ((await withPassword.client.from("channels").select("id").eq("community_id", FTR)).data ?? []).length, 0);
  expect("ny: ser ingen FTR-innlegg", ((await withPassword.client.from("posts").select("id").eq("community_id", FTR)).data ?? []).length, 0);
  expect("ny: invitasjonen kan ikke brukes igjen", (await accept(withPassword.client, nyInvitation))?.reason, "already-used");
  expect("ny: fortsatt ett medlemskap", (await admin.from("memberships").select("id").eq("user_id", ny.id)).data?.length, 1);
  const viaLink = await signInByLink(ny.email);
  expect("ny: e-postlenke virker fortsatt, samme konto", (await viaLink.auth.getUser()).data.user?.id, ny.id);

  // Wrong password, and an address with no account: one answer.
  const wrong = await signInByPassword(ny.email, passphrase("feil"));
  const nobody = await signInByPassword(address("ingen"), passphrase("feil"));
  expect("feil passord: avvises", wrong.code, "invalid_credentials");
  expect("ukjent adresse: samme svar som feil passord", nobody.code, wrong.code);

  // ── 2. An account that already exists, confirmed, with no password ──────
  // However it came to exist, and however it has signed in until now — here
  // it has an established session from an emailed link — an approval does not
  // activate it. It gets the invitation, exactly like someone with no account.
  const mia = await signInHandle("miaminge"); // FTR admin
  const gammel = { email: address("gammel"), id: "" };
  gammel.id = (await admin.auth.admin.createUser({ email: gammel.email, email_confirm: true, password: passphrase("ignorert") })).data.user!.id;
  accounts.add(gammel.id);
  const gammelLink = await signInByLink(gammel.email);
  expect("bekreftet: kontoen er bekreftet og har en gyldig sesjon", Boolean((await authUser(gammel.id))?.email_confirmed_at) && (await gammelLink.auth.getUser()).data.user?.id === gammel.id, true);
  expect("bekreftet: et passord gitt ved opprettelsen finnes ikke", (await security(gammel.id))?.password_set_at ?? null, null);
  const gammelApproved = await approve(gammel.email, emma, TU, "Konto gammel");
  expect("bekreftet: godkjenning aktiverer ikke en konto uten passord", gammelApproved?.outcome, "invited");
  expect("bekreftet: godkjenningen gir en invitasjon", Boolean(gammelApproved?.token), true);
  expect("bekreftet: ingen medlemskapsrad av godkjenningen", (await admin.from("memberships").select("id").eq("user_id", gammel.id)).data?.length, 0);
  expect("bekreftet: sesjonen er ikke medlem", (await gammelLink.rpc("is_member", { cid: TU })).data, false);
  expect("bekreftet: ser ingen TU-kanaler", ((await gammelLink.from("channels").select("id").eq("community_id", TU)).data ?? []).length, 0);
  expect("bekreftet: ser ingen TU-innlegg", ((await gammelLink.from("posts").select("id").eq("community_id", TU)).data ?? []).length, 0);
  const { data: gammelRequest } = await admin.from("access_requests").select("id").eq("community_id", TU).eq("email", gammel.email).single();
  const approvedAgain = (await emma.rpc("approve_access_request", { p_request_id: gammelRequest!.id })).data?.[0];
  expect("bekreftet: en gjentatt godkjenning aktiverer heller ikke", approvedAgain?.outcome, "invited");
  expect("bekreftet: og lager ikke en invitasjon til", (await admin.from("invitations").select("id").eq("email", gammel.email)).data?.length, 1);
  expect("bekreftet: fortsatt ingen medlemskapsrad", (await admin.from("memberships").select("id").eq("user_id", gammel.id)).data?.length, 0);
  const gammelToken = gammelApproved!.token as string;

  // The invitation, in hand, with a valid session: still no way in.
  expect("bekreftet: invitasjonen venter på passordet", (await accept(gammelLink, gammelToken))?.reason, "password-required");
  // Saying the password exists is not having one.
  await gammelLink.auth.updateUser({ data: { password_set: true, has_password: true, password_set_at: new Date().toISOString() } });
  expect("juks: egne metadata teller ikke", (await accept(gammelLink, gammelToken))?.reason, "password-required");
  const fakedRow = await gammelLink.from("account_security").upsert({ user_id: gammel.id, password_set_at: new Date().toISOString() }).select();
  expect("juks: kan ikke skrive at passordet finnes", (fakedRow.data ?? []).length, 0);
  expect("juks: kan ikke skrive et aktivt medlemskap", ((await gammelLink.from("memberships").insert({ user_id: gammel.id, community_id: TU, role: "member", status: "active" }).select()).data ?? []).length, 0);
  expect("juks: funksjonen bak kontrollen kan ikke kalles direkte", Boolean((await gammelLink.rpc("accept_invitation_token_for_account", { p_token: gammelToken })).error), true);
  // And if some later function forgot the check: run the acceptance logic
  // itself in this account's name, past both functions. The table refuses.
  if (!/^[0-9a-f]{64}$/.test(gammelToken) || !/^[0-9a-f-]{36}$/.test(gammel.id)) throw new Error("uventet token eller id");
  const past = sqlRefusal(
    `begin; select set_config('request.jwt.claims', '{"sub":"${gammel.id}","role":"authenticated"}', true); select reason from public.accept_invitation_token_for_account('${gammelToken}'); commit;`,
  );
  expect("tabell: et medlemskap aktiveres ikke for en konto uten passord, uansett vei", /cannot be activated before the account has a password/.test(past), true);
  expect("tabell: ingen medlemskapsrad etter forsøket", (await admin.from("memberships").select("id").eq("user_id", gammel.id)).data?.length, 0);
  expect("tabell: invitasjonen er ikke brukt opp av forsøket", ((await fresh().rpc("invitation_preview", { p_token: gammelToken })).data ?? []).length, 1);
  // What is not an invitation, or no longer one, is refused as it always was.
  expect("ugyldig: en oppdiktet invitasjon", (await accept(gammelLink, "0".repeat(64)))?.reason, "invalid");
  const { data: gammelInvitation } = await admin.from("invitations").select("id, expires_at").eq("email", gammel.email).single();
  await admin.from("invitations").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", gammelInvitation!.id);
  expect("utløpt: en utløpt invitasjon", (await accept(gammelLink, gammelToken))?.reason, "expired");
  await admin.from("invitations").update({ expires_at: gammelInvitation!.expires_at }).eq("id", gammelInvitation!.id);
  expect("bekreftet: fortsatt ingen medlemskap etter alle forsøkene", (await admin.from("memberships").select("id").eq("user_id", gammel.id)).data?.length, 0);

  // The password, chosen in the session the emailed link gave; then the same invitation.
  const gammelPassword = passphrase("gammel");
  expect("bekreftet: oppretter passord i lenkesesjonen", (await gammelLink.auth.updateUser({ password: gammelPassword })).error, null);
  expect("bekreftet: nå godtas invitasjonen", (await accept(gammelLink, gammelToken))?.reason, "joined");
  expect("bekreftet: aktivt TU-medlem, samme konto", (await admin.from("memberships").select("user_id, status").eq("user_id", gammel.id).eq("community_id", TU).single()).data?.status, "active");
  expect("bekreftet: velkomstkortet vises", (await gammelLink.rpc("my_onboarding_visible", { p_community_id: TU })).data, true);
  expect("gjenbruk: invitasjonen kan ikke brukes en gang til", (await accept(gammelLink, gammelToken))?.reason, "already-used");
  expect("gjenbruk: fortsatt ett medlemskap", (await admin.from("memberships").select("id").eq("user_id", gammel.id)).data?.length, 1);
  expect("bekreftet: fortsatt én konto for adressen", (await admin.from("profiles").select("id").eq("email", gammel.email)).data?.length, 1);

  // ── 2b. An account with a password joins a second community ────────────
  // Approved, it is activated on the spot — nothing more is asked of it —
  // and it is the same account with the same password in both.
  const gammelSetAt = (await security(gammel.id))?.password_set_at;
  const ftrJoin = await approve(gammel.email, mia, FTR, "Gammel i FTR");
  expect("andre fellesskap: konto med passord aktiveres ved godkjenning", ftrJoin?.outcome, "activated");
  expect("andre fellesskap: uten invitasjon å vente på", ftrJoin?.token ?? null, null);
  expect("andre fellesskap: medlem av FTR med sesjonen den hadde", (await gammelLink.rpc("is_member", { cid: FTR })).data, true);
  expect("andre fellesskap: egen velkomst der", (await gammelLink.rpc("my_onboarding_visible", { p_community_id: FTR })).data, true);
  expect("andre fellesskap: ingen ny passordrunde", (await security(gammel.id))?.password_set_at, gammelSetAt);
  expect("andre fellesskap: samme konto i begge", (await admin.from("memberships").select("community_id").eq("user_id", gammel.id).order("community_id")).data?.map((row) => row.community_id).join(), `${FTR},${TU}`);
  const bothWays = await signInByPassword(gammel.email, gammelPassword);
  expect("andre fellesskap: samme passord, samme konto", bothWays.userId, gammel.id);
  expect("andre fellesskap: ser FTR-kanaler", ((await bothWays.client.from("channels").select("id").eq("community_id", FTR)).data ?? []).length > 0, true);
  expect("andre fellesskap: fortsatt én konto", (await admin.from("profiles").select("id").eq("email", gammel.email)).data?.length, 1);
  // Two approvals, two communities — and no third.
  expect("andre fellesskap: ingen tilgang til et tredje", (await bothWays.client.rpc("is_member", { cid: UTR })).data, false);
  expect("andre fellesskap: ser ingen UTR-kanaler", ((await bothWays.client.from("channels").select("id").eq("community_id", UTR)).data ?? []).length, 0);
  // Emma approved TU; that gave nobody FTR. `ny` is still in TU alone.
  expect("andre fellesskap: TU-godkjenning ga ikke FTR", (await withPassword.client.rpc("is_member", { cid: FTR })).data, false);
  // An FTR administrator cannot approve a TU request, password or not.
  const crossEmail = address("kryss");
  await fresh().rpc("request_community_access", { p_slug: await slugOf(TU), p_email: crossEmail, p_display_name: "Kryss" });
  const { data: crossRequest } = await admin.from("access_requests").select("id").eq("community_id", TU).eq("email", crossEmail).single();
  expect("andre fellesskap: FTR-admin kan ikke godkjenne en TU-forespørsel", ((await mia.rpc("approve_access_request", { p_request_id: crossRequest!.id })).data ?? []).length, 0);
  const gammelBefore = await footprint(gammel.id);

  // ── 2c. Replacing a password takes more than a session ──────────────────
  expect("eksisterende: logger inn med passord", (await signInByPassword(gammel.email, gammelPassword)).userId, gammel.id);
  expect("eksisterende: og fortsatt med lenke", (await (await signInByLink(gammel.email)).auth.getUser()).data.user?.id, gammel.id);
  expect("eksisterende: andres passord virker ikke", (await signInByPassword(gammel.email, nyPassword)).code, "invalid_credentials");
  const noticesBefore = (await mailsTo(gammel.email)).filter((mail) => mail.subject === "Passordet ditt på TING er endret").length;
  expect("eksisterende: ett varsel for det ene passordet", noticesBefore, 1);

  // A session and nothing else — straight at the Auth API, as a thief would.
  const thief = await signInByLink(gammel.email);
  const attempt = passphrase("tyv");
  const direct = await thief.auth.updateUser({ password: attempt });
  expect("tyv: en sesjon alene kan ikke bytte passordet", Boolean(direct.error), true);
  const guessedCurrent = await thief.auth.updateUser({ password: attempt, current_password: passphrase("gjetning") });
  expect("tyv: heller ikke med et gjettet nåværende passord", Boolean(guessedCurrent.error), true);
  // The session a thief more often holds: one that signed in hours ago.
  await ageSession(thief, 3);
  expect("tyv: en gammel sesjon får ingen tillatelse", (await thief.rpc("authorize_password_change")).data, false);
  expect("tyv: og kan fortsatt ikke bytte passordet", Boolean((await thief.auth.updateUser({ password: attempt })).error), true);
  // Somebody else's permission is theirs alone.
  expect("tyv: en annen kontos tillatelse", (await withPassword.client.rpc("authorize_password_change")).data, true);
  expect("tyv: hjelper ikke denne kontoen", Boolean((await thief.auth.updateUser({ password: attempt })).error), true);
  expect("tyv: tyvens passord virker ikke", (await signInByPassword(gammel.email, attempt)).code, "invalid_credentials");
  expect("tyv: eierens passord virker fortsatt", (await signInByPassword(gammel.email, gammelPassword)).userId, gammel.id);
  expect(
    "tyv: ingen varsel om passordbytte ble sendt for forsøkene",
    (await mailsTo(gammel.email)).filter((mail) => mail.subject === "Passordet ditt på TING er endret").length,
    noticesBefore,
  );
  expect("tyv: ikke-autentisert får ingen tillatelse", Boolean((await fresh().rpc("authorize_password_change")).error), true);

  // The owner, having just proven the current password.
  const otherDevice = await signInByLink(gammel.email);
  const changer = (await signInByPassword(gammel.email, gammelPassword)).client;
  const gammelPassword2 = passphrase("gammel-2");
  expect("eier: uten tillatelse nekter databasen også eieren", Boolean((await changer.auth.updateUser({ password: gammelPassword2 })).error), true);
  expect("eier: nettopp bevist passord gir tillatelse", (await changer.rpc("authorize_password_change")).data, true);
  expect("eier: endrer passord", (await changer.auth.updateUser({ password: gammelPassword2, current_password: gammelPassword })).error, null);
  expect("eier: tillatelsen er brukt opp av byttet", Boolean((await changer.auth.updateUser({ password: passphrase("en-til") })).error), true);
  expect("eier: andre enheter logges ut", Boolean((await otherDevice.auth.refreshSession()).error), true);
  expect("eier: enheten som endret, er fortsatt inne", (await changer.auth.refreshSession()).error, null);
  expect("eier: gammelt passord virker ikke", (await signInByPassword(gammel.email, gammelPassword)).code, "invalid_credentials");
  expect("eier: nytt passord virker", (await signInByPassword(gammel.email, gammelPassword2)).userId, gammel.id);
  expect("eier: medlemskap og profil er urørt", await footprint(gammel.id), gammelBefore);

  // The row is the owner's to read and nobody's to write.
  const own = await changer.from("account_security").select("user_id");
  expect("rad: eieren ser bare sin egen", (own.data ?? []).map((row) => row.user_id).join(), gammel.id);
  expect("rad: uautentisert ser ingen", ((await fresh().from("account_security").select("user_id")).data ?? []).length, 0);
  const forged = await changer.from("account_security")
    .update({ password_change_authorized_at: new Date().toISOString(), email_change_to: "kapret@example.com", email_change_armed_until: new Date(Date.now() + 60_000).toISOString() })
    .eq("user_id", gammel.id).select();
  expect("rad: eieren kan ikke skrive den", (forged.data ?? []).length, 0);
  expect("rad: og ikke sette inn en", ((await changer.from("account_security").insert({ user_id: gammel.id, email_change_to: "kapret@example.com" }).select()).data ?? []).length, 0);
  expect("rad: uendret etter forsøkene", (await security(gammel.id))?.email_change_to ?? null, null);
  expect("rad: uautentisert kan ikke be om e-postbytte", Boolean((await fresh().rpc("authorize_email_change", { p_new_email: "x@example.com" })).error), true);
  expect("rad: uautentisert kan ikke bekrefte", Boolean((await fresh().rpc("arm_email_change")).error), true);

  // ── 3. A password nobody proved is never a key ──────────────────────────
  // A stranger signs up over an address before its owner has an account.
  const victim = address("offer");
  const strangersPassword = passphrase("fremmed");
  const signup = await fresh().auth.signUp({ email: victim, password: strangersPassword });
  if (signup.data.user?.id) accounts.add(signup.data.user.id);
  expect("fremmed: registrering gir ingen sesjon", Boolean(signup.data.session), false);
  expect("fremmed: passordet virker ikke før bekreftelse", Boolean((await signInByPassword(victim, strangersPassword)).code), true);
  // The owner applies, is approved, and opens the approval email.
  const victimApproved = await approve(victim, emma, TU, "Rett Eier");
  expect("fremmed: ubekreftet konto gir invitasjon, ikke aktivering", victimApproved?.outcome, "invited");
  await breathe();
  const victimLink = await mintEmailSignInLink(admin, { email: victim, communityId: TU });
  expect("fremmed: godkjenningen gjenbruker kontoen", victimLink?.createdAccount, false);
  const owner = fresh();
  const ownerIn = await owner.auth.verifyOtp({ type: "email", token_hash: victimLink!.tokenHash });
  accounts.add(ownerIn.data.user!.id);
  expect("fremmed: eieren kommer inn med lenken", Boolean(ownerIn.data.session), true);
  expect("fremmed: den fremmedes passord gjelder ikke som kontoens", (await accept(owner, victimApproved!.token!))?.reason, "password-required");
  expect("fremmed: og logger ingen inn", (await signInByPassword(victim, strangersPassword)).code, "invalid_credentials");
  expect("fremmed: eieren velger sitt eget", (await owner.auth.updateUser({ password: passphrase("eier") })).error, null);
  expect("fremmed: eieren blir medlem", (await accept(owner, victimApproved!.token!))?.reason, "joined");
  expect("fremmed: den fremmedes passord virker fortsatt ikke", (await signInByPassword(victim, strangersPassword)).code, "invalid_credentials");
  // The same, over an account an approval has created and nobody has opened.
  const dormantEmail = address("sovende");
  const dormantApproved = await approve(dormantEmail, emma, TU, "Sovende Konto");
  await mintEmailSignInLink(admin, { email: dormantEmail, communityId: TU });
  await breathe();
  const over = await fresh().auth.signUp({ email: dormantEmail, password: strangersPassword });
  expect("sovende: registrering oppå kontoen gir ingen sesjon", Boolean(over.data.session), false);
  const dormantUser = (await admin.from("profiles").select("id").eq("email", dormantEmail).single()).data!;
  accounts.add(dormantUser.id);
  expect("sovende: kontoen er fortsatt ubekreftet", (await authUser(dormantUser.id))?.email_confirmed_at ?? null, null);
  expect("sovende: ingen medlemskap av å registrere seg", (await admin.from("memberships").select("id").eq("user_id", dormantUser.id)).data?.length, 0);
  // A sign-up over the account may replace the token the approval email
  // carries; the invitation page then offers a new sign-in link, as here.
  await breathe();
  const dormantLink = await mintEmailSignInLink(admin, { email: dormantEmail, communityId: TU });
  expect("sovende: ny lenke gjenbruker samme konto", dormantLink?.createdAccount, false);
  const realOwner = fresh();
  const realOwnerIn = await realOwner.auth.verifyOtp({ type: "email", token_hash: dormantLink!.tokenHash });
  expect("sovende: eieren kommer inn på samme konto", realOwnerIn.data.user?.id, dormantUser.id);
  await realOwner.auth.updateUser({ password: passphrase("sovende") });
  expect("sovende: invitasjonen virker fortsatt for eieren", (await accept(realOwner, dormantApproved!.token!))?.reason, "joined");
  expect("sovende: den fremmedes passord virker ikke", (await signInByPassword(dormantEmail, strangersPassword)).code, "invalid_credentials");

  // ── 4. Forgotten password ───────────────────────────────────────────────
  const unknown = address("ukjent");
  const askedKnown = await fresh().auth.resetPasswordForEmail(ny.email);
  const askedUnknown = await fresh().auth.resetPasswordForEmail(unknown);
  expect("glemt: kjent adresse besvares uten feil", askedKnown.error, null);
  expect("glemt: ukjent adresse besvares likt", askedUnknown.error, null);
  expect("glemt: ingenting sendes til en ukjent adresse", (await mailsTo(unknown)).length, 0);
  expect("glemt: ingen konto oppstår av å spørre", (await admin.from("profiles").select("id").eq("email", unknown)).data?.length, 0);
  const resetMail = (await mailsTo(ny.email)).find((mail) => mail.subject === "Velg nytt passord på TING");
  expect("glemt: e-posten kom fram", Boolean(resetMail), true);
  expect("glemt: fra TING", resetMail?.from, SENDER);
  expect("glemt: TING-malen, ikke standardteksten", resetMail?.html.includes(">Velg nytt passord</h1>") && !/Reset Password|Follow this link/i.test(resetMail.html), true);
  expect("glemt: TING-logoen", resetMail?.html.includes(`src="${SITE}${EMAIL_LOGO.path}"`), true);
  const resetLinks = links(resetMail?.html ?? "");
  expect("glemt: nøyaktig én lenke", resetLinks.length, 1);
  const resetUrl = new URL(resetLinks[0] ?? SITE);
  expect("glemt: lenken går til TINGs egen side", resetUrl.origin + resetUrl.pathname, `${SITE}/nytt-passord`);
  expect("glemt: lenken bærer bare tokenet — ingen viderekobling å tukle med", [...resetUrl.searchParams.keys()].join(), "token_hash");
  const resetToken = resetUrl.searchParams.get("token_hash") ?? "";
  expect("glemt: det gamle passordet står ikke i e-posten", resetMail?.html.includes(nyPassword), false);
  // Opening the page spends nothing (a mail scanner's GET).
  const opened = await fetch(resetLinks[0], { redirect: "manual" });
  expect("glemt: siden åpnes uten å bruke lenken", opened.status, 200);

  // Asking changed nothing: the password from before still signs in.
  const stillValid = await signInByPassword(ny.email, nyPassword);
  expect("glemt: passordet er uendret til lenken brukes", stillValid.code, null);
  const standing = stillValid.client;
  const nyBeforeReset = await footprint(ny.id);
  const recovering = fresh();
  const recovered = await recovering.auth.verifyOtp({ type: "recovery", token_hash: resetToken });
  expect("glemt: lenken logger inn riktig konto", recovered.data.user?.id, ny.id);
  const nyPassword2 = passphrase("ny-2");
  expect("glemt: lenken er beviset — en sesjon rett fra innboksen får tillatelse", (await recovering.rpc("authorize_password_change")).data, true);
  expect("glemt: nytt passord settes", (await recovering.auth.updateUser({ password: nyPassword2 })).error, null);
  expect("glemt: lenken kan ikke brukes to ganger", Boolean((await fresh().auth.verifyOtp({ type: "recovery", token_hash: resetToken })).data.session), false);
  expect("glemt: en oppdiktet lenke avvises", Boolean((await fresh().auth.verifyOtp({ type: "recovery", token_hash: "ikke-en-lenke" })).data.session), false);
  expect("glemt: gammelt passord virker ikke", (await signInByPassword(ny.email, nyPassword)).code, "invalid_credentials");
  expect("glemt: nytt passord virker, samme konto", (await signInByPassword(ny.email, nyPassword2)).userId, ny.id);
  expect("glemt: sesjoner fra før tilbakestillingen er avsluttet", Boolean((await standing.auth.refreshSession()).error), true);
  expect("glemt: medlemskap og profil er urørt", await footprint(ny.id), nyBeforeReset);
  expect("glemt: medlemskapet er det samme som før passordet ble byttet første gang", await footprint(ny.id), before);

  // ── 5. Email change: what must not work ─────────────────────────────────
  const flytter = await newMember("flytter", emma);
  expect("flytter: måtte velge passord før invitasjonen gjaldt", `${flytter.refusal}→${flytter.joined}`, "password-required→joined");
  const flytterPassword = flytter.password;
  const target = address("ny-adresse");
  const refusedTargets = [address("nektet-1"), address("nektet-2"), address("nektet-3")];
  const flytterBefore = await footprint(flytter.id);

  // A session alone — a perfectly valid one, as a thief would hold. Auth
  // accepts the request and emails its link (it sends before anything here is
  // asked), but nothing the owner authorised is waiting, so the link is inert.
  const sessionOnly = await flytter.client.auth.updateUser({ email: refusedTargets[0] });
  expect("bytte: Auth tar imot forespørselen fra en sesjon alene", sessionOnly.error, null);
  expect("bytte: og noterer at den sendte, så dens egen grense per konto gjelder", Boolean((await authUser(flytter.id))?.email_change_sent_at), true);
  expect("bytte: adressen er uendret", (await authUser(flytter.id))?.email, flytter.email);
  expect("bytte: kontoen viser ingenting som venter", (await security(flytter.id))?.email_change_to ?? null, null);
  expect("bytte: lenkesesjon får ikke autorisere", (await flytter.client.rpc("authorize_email_change", { p_new_email: refusedTargets[0] })).data, "reauthenticate");
  expect("bytte: uten autorisasjon er det ingenting å bekrefte", (await flytter.client.rpc("arm_email_change")).data, false);
  const inert = (await mailsTo(refusedTargets[0])).flatMap((mail) => links(mail.html)).map((href) => new URL(href).searchParams.get("token_hash") ?? "");
  expect("bytte: lenken som ble sendt, fullfører ingenting", inert.length > 0 && (await Promise.all(inert.map((token) => fresh().auth.verifyOtp({ type: "email_change", token_hash: token })))).every((result) => result.error), true);
  expect("bytte: adressen er uendret etter den", (await authUser(flytter.id))?.email, flytter.email);

  // The password, proven just now — but set a minute ago.
  const proven = (await signInByPassword(flytter.email, flytterPassword)).client;
  expect("bytte: nytt passord må modnes først", (await proven.rpc("authorize_email_change", { p_new_email: refusedTargets[1] })).data, "cooldown");
  await breathe();
  await proven.auth.updateUser({ email: refusedTargets[1] });
  expect("bytte: uten autorisasjon er det fortsatt ingenting å bekrefte", (await flytter.client.rpc("arm_email_change")).data, false);
  // An account whose session did not prove a password.
  const noPassword = await signInByLink(gammel.email);
  expect("bytte: lenkesesjon på en annen konto", (await noPassword.rpc("authorize_email_change", { p_new_email: address("x") })).data, "reauthenticate");

  await agePassword(flytter.id);
  expect("bytte: samme adresse", (await proven.rpc("authorize_email_change", { p_new_email: ` ${flytter.email.toUpperCase()} ` })).data, "same");
  expect("bytte: ikke en adresse", (await proven.rpc("authorize_email_change", { p_new_email: "ikke en adresse" })).data, "invalid");
  // A password session that has gone stale no longer proves anything.
  const staleProof = (await signInByPassword(flytter.email, flytterPassword)).client;
  await ageSession(staleProof, 1);
  expect("bytte: et passord bevist for en time siden holder ikke", (await staleProof.rpc("authorize_email_change", { p_new_email: target })).data, "reauthenticate");

  // An address that belongs to someone else.
  expect("opptatt: autorisasjonen sier ingenting om andre kontoer", (await proven.rpc("authorize_email_change", { p_new_email: emmaProfile.email })).data, "authorized");
  await breathe();
  const taken = await proven.auth.updateUser({ email: emmaProfile.email });
  expect("opptatt: Auth nekter en adresse som er i bruk", taken.error?.code, "email_exists");
  expect("opptatt: adressen er uendret", (await authUser(flytter.id))?.email, flytter.email);
  expect("opptatt: Emmas konto er urørt", (await authUser(emmaProfile.id))?.email, emmaProfile.email);
  expect("opptatt: fortsatt én konto på Emmas adresse", (await admin.from("profiles").select("id").eq("email", emmaProfile.email)).data?.length, 1);
  expect("opptatt: Emma fikk ingen bekreftelse", (await mailsTo(emmaProfile.email)).filter((mail) => mail.subject.startsWith("Bekreft ny")).length, 0);

  // Authorised for one address, asks Auth for another.
  expect("bytte: autoriserer én adresse", (await proven.rpc("authorize_email_change", { p_new_email: target })).data, "authorized");
  await breathe();
  await proven.auth.updateUser({ email: refusedTargets[2] });
  expect("bytte: en annen adresse enn den autoriserte kan ikke bekreftes", (await flytter.client.rpc("arm_email_change")).data, false);
  const elsewhere = (await mailsTo(refusedTargets[2])).flatMap((mail) => links(mail.html)).map((href) => new URL(href).searchParams.get("token_hash") ?? "");
  expect("bytte: og lenken dit fullfører ingenting", (await Promise.all(elsewhere.map((token) => fresh().auth.verifyOtp({ type: "email_change", token_hash: token })))).every((result) => result.error), true);
  expect("bytte: adressen er fortsatt uendret", (await authUser(flytter.id))?.email, flytter.email);

  // ── 6. Email change: the supported flow, old inbox never involved ───────
  expect("bytte: autoriserer på nytt", (await proven.rpc("authorize_email_change", { p_new_email: target })).data, "authorized");
  await breathe();
  const requested = await proven.auth.updateUser({ email: target });
  expect("bytte: forespørselen godtas", requested.error, null);
  expect("bytte: venter på den nye adressen", (await security(flytter.id))?.email_change_to, target);
  expect("bytte: innloggingsadressen er uendret til den bekreftes", (await authUser(flytter.id))?.email, flytter.email);
  expect("bytte: gammel adresse logger fortsatt inn", (await signInByPassword(flytter.email, flytterPassword)).userId, flytter.id);
  expect("bytte: ny adresse logger ikke inn ennå", (await signInByPassword(target, flytterPassword)).code, "invalid_credentials");

  const confirmMail = (await mailsTo(target)).filter((mail) => mail.subject === "Bekreft ny e-postadresse på TING");
  expect("bytte: bekreftelsen gikk til den nye adressen", confirmMail.length, 1);
  expect("bytte: fra TING", confirmMail[0]?.from, SENDER);
  expect("bytte: TING-malen", confirmMail[0]?.html.includes(">Bekreft ny e-postadresse</h1>") && !/Confirm Change of Email|Follow this link/i.test(confirmMail[0].html), true);
  const confirmLinks = links(confirmMail[0]?.html ?? "");
  expect("bytte: nøyaktig én lenke", confirmLinks.length, 1);
  const confirmUrl = new URL(confirmLinks[0] ?? SITE);
  expect("bytte: lenken går til TINGs egen side", confirmUrl.origin + confirmUrl.pathname, `${SITE}/bekreft-e-post`);
  expect("bytte: lenken bærer bare tokenet", [...confirmUrl.searchParams.keys()].join(), "token_hash");
  const confirmToken = confirmUrl.searchParams.get("token_hash") ?? "";
  expect(
    "bytte: den gamle adressen ble ikke bedt om å bekrefte noe",
    (await mailsTo(flytter.email)).filter((mail) => mail.subject.startsWith("Bekreft ny")).length,
    0,
  );

  // Opening the link (a scanner, a preview) changes nothing.
  expect("bytte: siden åpnes", (await fetch(confirmLinks[0], { redirect: "manual" })).status, 200);
  expect("bytte: adressen er uendret etter et oppslag", (await authUser(flytter.id))?.email, flytter.email);
  // The link by itself — whoever received it, without the account's session.
  const linkOnly = await fresh().auth.verifyOtp({ type: "email_change", token_hash: confirmToken });
  expect("bytte: lenken alene fullfører ikke", Boolean(linkOnly.error), true);
  expect("bytte: adressen er uendret etter lenken alene", (await authUser(flytter.id))?.email, flytter.email);
  // Somebody else's session cannot arm this account's change.
  expect("bytte: en annen konto kan ikke bekrefte", (await changer.rpc("arm_email_change")).data, false);
  expect("bytte: fortsatt uendret", Boolean((await fresh().auth.verifyOtp({ type: "email_change", token_hash: confirmToken })).error), true);

  // A request older than any emailed link can be is not confirmable.
  await admin.from("account_security").update({ email_change_requested_at: new Date(Date.now() - 25 * 3_600_000).toISOString() }).eq("user_id", flytter.id);
  expect("utløpt: en forespørsel fra i går kan ikke bekreftes", (await flytter.client.rpc("arm_email_change")).data, false);
  await admin.from("account_security").update({ email_change_requested_at: new Date().toISOString() }).eq("user_id", flytter.id);

  // A competing request made with the session alone takes the owner's place
  // at Auth — and with that, nothing is confirmable until the owner asks again.
  await breathe();
  await flytter.client.auth.updateUser({ email: refusedTargets[0] });
  expect("konkurrerende: etter en fremmed forespørsel er ingenting bekreftbart", (await flytter.client.rpc("arm_email_change")).data, false);
  expect("konkurrerende: eierens første lenke fullfører ikke lenger", Boolean((await fresh().auth.verifyOtp({ type: "email_change", token_hash: confirmToken })).error), true);
  expect("konkurrerende: adressen er uendret", (await authUser(flytter.id))?.email, flytter.email);

  // The owner asks again; then cancels. Cancelled, the link is dead even for the owner.
  const provenAgain = (await signInByPassword(flytter.email, flytterPassword)).client;
  expect("bytte: ny autorisasjon", (await provenAgain.rpc("authorize_email_change", { p_new_email: target })).data, "authorized");
  await breathe();
  expect("bytte: ny forespørsel", (await provenAgain.auth.updateUser({ email: target })).error, null);
  const cancelledToken =
    (await mailsTo(target))
      .filter((mail) => mail.subject === "Bekreft ny e-postadresse på TING")
      .map((mail) => new URL(links(mail.html)[0]).searchParams.get("token_hash") ?? "")
      .find((token) => token !== confirmToken) ?? "";
  expect("avbrutt: eieren avbryter", (await flytter.client.rpc("cancel_email_change")).data, true);
  expect("avbrutt: ingenting å bekrefte", (await flytter.client.rpc("arm_email_change")).data, false);
  expect("avbrutt: lenken virker ikke", cancelledToken !== "" && Boolean((await fresh().auth.verifyOtp({ type: "email_change", token_hash: cancelledToken })).error), true);
  expect("avbrutt: adressen er uendret", (await authUser(flytter.id))?.email, flytter.email);

  // Asked a third time — the password is needed every time — and confirmed.
  const provenThird = (await signInByPassword(flytter.email, flytterPassword)).client;
  expect("bytte: autorisasjon etter avbrudd", (await provenThird.rpc("authorize_email_change", { p_new_email: target })).data, "authorized");
  await breathe();
  expect("bytte: forespørsel etter avbrudd", (await provenThird.auth.updateUser({ email: target })).error, null);
  const earlier = new Set([confirmToken, cancelledToken]);
  const liveToken =
    (await mailsTo(target))
      .filter((mail) => mail.subject === "Bekreft ny e-postadresse på TING")
      .map((mail) => new URL(links(mail.html)[0]).searchParams.get("token_hash") ?? "")
      .find((token) => !earlier.has(token)) ?? "";
  expect("bytte: den nye e-posten har sin egen lenke", liveToken !== "", true);

  // The owner's ordinary session — any of theirs — arms it; then the link.
  expect("bytte: eieren bekrefter mens hen er logget inn", (await flytter.client.rpc("arm_email_change")).data, true);
  const completed = await fresh().auth.verifyOtp({ type: "email_change", token_hash: liveToken });
  expect("bytte: lenken fullfører byttet", completed.error, null);
  expect("bytte: samme konto-id", completed.data.user?.id, flytter.id);
  expect("bytte: kontoen har den nye adressen", (await authUser(flytter.id))?.email, target);
  expect("bytte: kontoraden følger Auth", (await admin.from("profiles").select("email").eq("id", flytter.id).single()).data?.email, target);
  expect("bytte: ingen ny konto oppsto", (await admin.from("profiles").select("id").in("email", [flytter.email, target])).data?.length, 1);
  expect("bytte: medlemskap, profil og samtaler er urørt", await footprint(flytter.id), flytterBefore);
  expect("bytte: ingenting venter lenger", (await security(flytter.id))?.email_change_to ?? null, null);
  expect("bytte: lenken kan ikke brukes to ganger", Boolean((await fresh().auth.verifyOtp({ type: "email_change", token_hash: liveToken })).error), true);
  expect("bytte: en eldre lenke kan heller ikke brukes nå", Boolean((await fresh().auth.verifyOtp({ type: "email_change", token_hash: confirmToken })).error), true);

  const moved = await signInByPassword(target, flytterPassword);
  expect("bytte: ny adresse + passord logger inn samme konto", moved.userId, flytter.id);
  expect("bytte: gammel adresse logger ikke lenger inn", (await signInByPassword(flytter.email, flytterPassword)).code, "invalid_credentials");
  expect("bytte: e-postlenke til ny adresse, samme konto", (await (await signInByLink(target)).auth.getUser()).data.user?.id, flytter.id);
  expect("bytte: fortsatt TU-medlem", (await moved.client.rpc("is_member", { cid: TU })).data, true);
  expect("bytte: fortsatt ikke FTR-medlem", (await moved.client.rpc("is_member", { cid: FTR })).data, false);
  expect("bytte: ser ingen FTR-kanaler", ((await moved.client.from("channels").select("id").eq("community_id", FTR)).data ?? []).length, 0);
  expect("bytte: økten fra før byttet er samme konto", (await flytter.client.auth.refreshSession()).data.user?.id, flytter.id);

  const notice = (await mailsTo(flytter.email)).filter((mail) => mail.subject === "E-postadressen for TING-kontoen din er endret");
  expect("bytte: den gamle adressen varsles", notice.length, 1);
  expect("bytte: varselet røper ikke den nye adressen", notice[0]?.html.includes(target), false);
  expect("bytte: varselet ber ikke om noe", links(notice[0]?.html ?? "").length, 0);

  // The old address is free again, and is nobody's way into this account.
  const reused = await fresh().auth.signInWithOtp({ email: flytter.email });
  expect("bytte: den gamle adressen kan be om lenke som enhver annen", reused.error, null);
  const stranger = (await admin.from("profiles").select("id").eq("email", flytter.email).maybeSingle()).data;
  if (stranger) accounts.add(stranger.id);
  expect("bytte: det gir i så fall en annen, tom konto", stranger?.id === flytter.id, false);
  expect("bytte: uten medlemskap", (await admin.from("memberships").select("id").eq("user_id", stranger?.id ?? randomUUID())).data?.length, 0);

  // ── 7. Guessing is slowed, per account and per address ──────────────────
  // What the server does around every password check. The counters are tried
  // here directly; the real check on either side of them is Auth's.
  const guessed = address("gjettet");
  const waits: number[] = [];
  for (let i = 0; i < 7; i += 1) waits.push(await beginAttempt(guessed));
  expect("gjetting: fem forsøk slipper til, så ventetid", waits.map((wait) => (wait === 0 ? "ok" : "vent")).join(" "), "ok ok ok ok ok vent vent");
  expect("gjetting: ventetiden begynner på et halvt minutt", waits[5] > 0 && waits[5] <= 30, true);
  const { data: guessedKey } = await admin.rpc("password_throttle_key", { p_email: guessed });
  const counted = async (key: string) => (await admin.from("auth_throttle").select("attempts, blocked_until").eq("key", key).maybeSingle()).data;
  expect("gjetting: forsøk under ventetiden telles ikke, og forlenger den ikke", (await counted(guessedKey as string))?.attempts, 5);
  expect("gjetting: tabellen lagrer ikke adressen i klartekst", String(guessedKey).includes(guessed), false);
  // After the wait, each further miss doubles it.
  const expire = (key: string) => admin.from("auth_throttle").update({ blocked_until: new Date(Date.now() - 1000).toISOString() }).eq("key", key);
  const ladder: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    await expire(guessedKey as string);
    await beginAttempt(guessed);
    ladder.push(await beginAttempt(guessed));
  }
  expect("gjetting: ventetiden dobles og stopper på et kvarter", ladder.map((wait) => Math.round(wait / 60)).join(","), "1,2,4,8,15,15");
  // The same for an address that has an account: nothing tells the two apart.
  const known: number[] = [];
  for (let i = 0; i < 7; i += 1) known.push(await beginAttempt(ny.email));
  expect("gjetting: en konto som finnes, behandles likt", known.map((wait) => (wait === 0 ? "ok" : "vent")).join(" "), "ok ok ok ok ok vent vent");
  expect("gjetting: ulik skrivemåte er samme konto", (await beginAttempt(` ${ny.email.toUpperCase()} `)) > 0, true);
  // While it says wait the server does not ask Auth, so the right password
  // gets nobody in — and a new password, set by its owner, is a fresh start.
  const resetting = fresh();
  const { data: again } = await admin.auth.admin.generateLink({ type: "recovery", email: ny.email });
  await resetting.auth.verifyOtp({ type: "recovery", token_hash: again!.properties!.hashed_token });
  await resetting.rpc("authorize_password_change");
  expect("gjetting: eieren setter nytt passord via innboksen", (await resetting.auth.updateUser({ password: passphrase("ny-3") })).error, null);
  expect("gjetting: et nytt passord nullstiller tellingen for kontoen", await beginAttempt(ny.email), 0);
  // The right password clears the account's count.
  const lucky = address("riktig");
  for (let i = 0; i < 4; i += 1) await beginAttempt(lucky);
  await admin.rpc("finish_password_attempt", { p_email: lucky, p_ip: "", p_valid: true });
  const afterSuccess: number[] = [];
  for (let i = 0; i < 5; i += 1) afterSuccess.push(await beginAttempt(lucky));
  expect("gjetting: riktig passord nullstiller, så fem nye forsøk slipper til", afterSuccess.join(), "0,0,0,0,0");

  // One network address working through a list of accounts.
  const sprayer = "203.0.113.77";
  const neighbour = "203.0.113.78";
  const sprayed: number[] = [];
  for (let i = 0; i < 21; i += 1) sprayed.push(await beginAttempt(address(`liste-${i}`), sprayer));
  expect("spredning: tjue kontoer fra én adresse slipper til", sprayed.slice(0, 20).every((wait) => wait === 0), true);
  expect("spredning: den tjueførste må vente", sprayed[20] > 0, true);
  expect("spredning: ventetiden er et kvarter", Math.round(sprayed[20] / 60), 15);
  expect("spredning: en annen adresse rammes ikke", await beginAttempt(address("nabo"), neighbour), 0);
  expect("spredning: uten kjent adresse gjelder bare kontogrensen", await beginAttempt(address("ukjent-adresse")), 0);
  // A success from a shared address takes its try back off that address.
  const office = "203.0.113.90";
  const colleague = address("kollega");
  for (let i = 0; i < 3; i += 1) {
    await beginAttempt(colleague, office);
    await admin.rpc("finish_password_attempt", { p_email: colleague, p_ip: office, p_valid: true });
  }
  expect("spredning: vellykkede innlogginger teller ikke mot adressen", (await counted(`password:ip:${office}`))?.attempts, 0);

  // Nobody but the server may count: a caller who could name an account and
  // an address could lock out whoever they liked.
  expect("teller: uautentisert kan ikke kalle den", Boolean((await fresh().rpc("begin_password_attempt", { p_email: ny.email, p_ip: "" })).error), true);
  expect("teller: en innlogget konto kan ikke kalle den", Boolean((await moved.client.rpc("begin_password_attempt", { p_email: ny.email, p_ip: "" })).error), true);
  expect("teller: eller nullstille den", Boolean((await moved.client.rpc("finish_password_attempt", { p_email: ny.email, p_ip: "", p_valid: true })).error), true);
  expect("teller: tabellen er ikke lesbar for en innlogget konto", ((await moved.client.from("auth_throttle").select("key")).data ?? []).length, 0);
  expect("teller: eller for en uautentisert", ((await fresh().from("auth_throttle").select("key")).data ?? []).length, 0);
  expect("teller: og ikke skrivbar", ((await moved.client.from("auth_throttle").delete().like("key", "password:%").select()).data ?? []).length, 0);

  // ── 8. A support fix with the service role is not in the way ────────────
  const fixed = address("rettet");
  expect("tjenesterolle: kan rette en adresse direkte", (await admin.auth.admin.updateUserById(gammel.id, { email: fixed, email_confirm: true })).error, null);
  expect("tjenesterolle: kontoraden følger", (await admin.from("profiles").select("email").eq("id", gammel.id).single()).data?.email, fixed);
}

async function cleanup() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const email of emails) {
    await admin.from("invitations").delete().eq("email", email);
    await admin.from("access_requests").delete().eq("email", email);
    const user = data.users.find((candidate) => candidate.email === email);
    if (user) accounts.add(user.id);
  }
  for (const id of accounts) await admin.auth.admin.deleteUser(id);
  if (throttleKeys.size > 0) await admin.from("auth_throttle").delete().in("key", [...throttleKeys]);
  await admin.from("notifications").delete().gte("created_at", started);
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(async () => {
    await cleanup();
    if (failures > 0) {
      console.error(`\n✗ ${failures} av ${checks} kontosikkerhetskontroller feilet.\n`);
      process.exit(1);
    }
    console.log(`✓ ${checks} kontosikkerhetskontroller passerte`);
  });
