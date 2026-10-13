/**
 * Checks that Supabase Auth is told the caller's network address — and that
 * nothing else changes because of it.
 *
 * Run with `npm run check:auth-forwarding`. Three parts:
 *
 * - The address itself (lib/client-ip.ts): it is the one the deployment's own
 *   proxy wrote, counted from the right of X-Forwarded-For, and never one a
 *   caller sent.
 * - The wrapper (lib/supabase/auth-forwarding.ts), against a recording
 *   `fetch`: which requests get the secret key and the address, which must
 *   never get either, and what happens when Supabase refuses the key.
 * - The real thing, against the local stack with the local stack's own secret
 *   key: every sign-in path TING uses, through genuine Supabase clients built
 *   the way the app builds them, with forwarding on. Sessions are the
 *   member's, the data API never sees the secret key, and row level security
 *   answers as it does without any of this.
 *
 * What this cannot show is the hosted platform acting on the header: the
 * local Auth server is not told to apply per-address limits. That half is the
 * production checklist in the README.
 *
 * No key, token or password is printed.
 */
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { clientAddressFrom, clientIpFrom } from "@/lib/client-ip";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { looksLikeSecretKey, resetAuthForwardingBreaker, withAuthForwarding } from "@/lib/supabase/auth-forwarding";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

let failures = 0;
let checks = 0;
// Kept aside: some cases below capture console.error to see what the app logs.
const report = console.error.bind(console);
function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  report(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

const PROJECT = "https://prosjekt.supabase.co";
const ANON = "anon-nokkel";
const SECRET = `sb_secret_${"x".repeat(24)}`;
const MEMBER = "203.0.113.5";

type Seen = { url: string; method: string; headers: Headers; body: unknown };

/** A `fetch` that only writes down what it was asked, and answers as told. */
function recorder(answer: (seen: Seen) => number | { status: number; body: string } = () => 200) {
  const calls: Seen[] = [];
  const fake: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const seen: Seen = {
      url: request ? request.url : String(input),
      method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
      headers: new Headers(init?.headers ?? request?.headers),
      body: init?.body,
    };
    calls.push(seen);
    const told = answer(seen);
    return typeof told === "number" ? new Response("{}", { status: told }) : new Response(told.body, { status: told.status });
  };
  return { fake, calls };
}

/** What the API gateway says when it does not accept the key it was given. */
const KEY_REFUSED = { status: 401, body: JSON.stringify({ message: "Invalid API key", hint: "Double check your Supabase API key." }) };
/** What Auth itself says about a member's bad or expired token. */
const TOKEN_REFUSED = { status: 401, body: JSON.stringify({ code: 401, error_code: "no_authorization", msg: "This endpoint requires a valid Bearer token" }) };

const forwarded = (seen: Seen | undefined) =>
  `${seen?.headers.get("apikey") === SECRET ? "hemmelig" : seen?.headers.get("apikey") === ANON ? "offentlig" : "annet"}/${seen?.headers.get("sb-forwarded-for") ?? "-"}`;

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx|js|css|html|json|map)$/.test(name) ? [path] : [];
  });
}

async function main() {
  // ── 1. Whose address a request has ──────────────────────────────────────
  expect("adresse: ingen proxy er til å stole på → ukjent", clientAddressFrom("203.0.113.5", 0), undefined);
  expect("adresse: mangler header → ukjent", clientAddressFrom(null, 1), undefined);
  expect("adresse: nginx alene, én verdi", clientAddressFrom("203.0.113.5", 1), "203.0.113.5");
  expect("adresse: det klienten selv skrev foran, leses ikke", clientAddressFrom("1.1.1.1, 10.0.0.1, 203.0.113.5", 1), "203.0.113.5");
  expect("adresse: en forfalsket «127.0.0.1» foran hjelper ikke", clientAddressFrom("127.0.0.1, 203.0.113.5", 1), "203.0.113.5");
  expect("adresse: mange forfalskede ledd endrer ingenting", clientAddressFrom(`${Array(50).fill("9.9.9.9").join(", ")}, 203.0.113.5`, 1), "203.0.113.5");
  expect("adresse: to egne proxyer → den ytterste så dette", clientAddressFrom("6.6.6.6, 203.0.113.5, 10.0.0.2", 2), "203.0.113.5");
  expect("adresse: for høyt antall proxyer gir ukjent, ikke klientens ord", clientAddressFrom("203.0.113.5", 2), undefined);
  expect("adresse: for lavt antall gir proxyens adresse, aldri en klientvalgt", clientAddressFrom("6.6.6.6, 203.0.113.5, 10.0.0.2", 1), "10.0.0.2");
  expect("adresse: ikke en adresse → ukjent", clientAddressFrom("203.0.113.5, ikke-en-adresse", 1), undefined);
  expect("adresse: forsøk på å smugle inn flere verdier i ett ledd", clientAddressFrom("203.0.113.5 198.51.100.1", 1), undefined);
  expect("adresse: IPv6 sendes videre som den er", clientAddressFrom("2001:DB8:1:2:aaaa:bbbb:cccc:dddd", 1), "2001:db8:1:2:aaaa:bbbb:cccc:dddd");
  expect("adresse: men telles hos TING per /64", clientIpFrom("2001:DB8:1:2:aaaa:bbbb:cccc:dddd", 1), "2001:db8:1:2::/64");
  expect("adresse: IPv4 skrevet som IPv6 er samme adresse", clientAddressFrom("::ffff:203.0.113.5", 1), "203.0.113.5");

  // ── 2. Which requests carry the secret key and the address ──────────────
  const on = { supabaseUrl: PROJECT, secretKey: SECRET, clientAddress: MEMBER };
  const headers = { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json", "X-Client-Info": "supabase-ssr" };

  // Off unless there is both a secret key and a trusted address.
  const plain = recorder();
  expect("av: uten hemmelig nøkkel er det samme fetch", withAuthForwarding(plain.fake, { ...on, secretKey: undefined }), plain.fake);
  expect("av: uten betrodd adresse er det samme fetch", withAuthForwarding(plain.fake, { ...on, clientAddress: undefined }), plain.fake);
  expect("av: den gamle service_role-nøkkelen duger ikke", withAuthForwarding(plain.fake, { ...on, secretKey: "eyJhbGciOiJIUzI1NiJ9.e30.x" }), plain.fake);
  expect("av: en offentlig nøkkel duger ikke", withAuthForwarding(plain.fake, { ...on, secretKey: `sb_publishable_${"x".repeat(24)}` }), plain.fake);
  expect("av: en tom nøkkel duger ikke", looksLikeSecretKey(""), false);

  // On: exactly the Auth endpoints Supabase limits per address.
  const forwardedCases: [string, string][] = [
    ["POST", "/auth/v1/token?grant_type=password"],
    ["POST", "/auth/v1/token?grant_type=refresh_token"],
    ["POST", "/auth/v1/token?grant_type=pkce"],
    ["POST", "/auth/v1/otp"],
    ["POST", "/auth/v1/recover"],
    ["POST", "/auth/v1/verify"],
    ["GET", "/auth/v1/verify?token=x&type=magiclink"],
    ["PUT", "/auth/v1/user"],
  ];
  for (const [method, path] of forwardedCases) {
    const rec = recorder();
    await withAuthForwarding(rec.fake, on)(`${PROJECT}${path}`, { method, headers, body: method === "GET" ? undefined : '{"a":1}' });
    expect(`på: ${method} ${path.split("?")[0]}${path.includes("?") ? "?…" : ""}`, forwarded(rec.calls[0]), `hemmelig/${MEMBER}`);
  }
  const shape = recorder();
  await withAuthForwarding(shape.fake, on)(`${PROJECT}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { ...headers, Authorization: "Bearer medlemmets-eget-token" },
    body: '{"email":"a@b.no"}',
  });
  expect("på: Authorization er medlemmets, urørt", shape.calls[0]?.headers.get("authorization"), "Bearer medlemmets-eget-token");
  expect("på: andre headere følger med", shape.calls[0]?.headers.get("x-client-info"), "supabase-ssr");
  expect("på: innholdet er urørt", shape.calls[0]?.body, '{"email":"a@b.no"}');
  expect("på: adressen er uendret", shape.calls[0]?.url, `${PROJECT}/auth/v1/token?grant_type=password`);
  expect("på: én forespørsel, ikke to", shape.calls.length, 1);
  const inbound = recorder();
  await withAuthForwarding(inbound.fake, on)(`${PROJECT}/auth/v1/otp`, { method: "POST", headers: { ...headers, "Sb-Forwarded-For": "6.6.6.6" }, body: "{}" });
  expect("på: en adresse noen andre har satt, erstattes", inbound.calls[0]?.headers.get("sb-forwarded-for"), MEMBER);
  const asRequest = recorder();
  await withAuthForwarding(asRequest.fake, on)(new Request(`${PROJECT}/auth/v1/recover`, { method: "POST", headers, body: "{}" }));
  expect("på: også når forespørselen kommer som et Request-objekt", forwarded(asRequest.calls[0]), `hemmelig/${MEMBER}`);

  // Never: everything else, the data API above all.
  const untouched: [string, string, string][] = [
    ["GET", `${PROJECT}/rest/v1/memberships?select=*`, "data-API-et (les)"],
    ["POST", `${PROJECT}/rest/v1/rpc/is_member`, "data-API-et (funksjon)"],
    ["PATCH", `${PROJECT}/rest/v1/profiles?id=eq.x`, "data-API-et (skriv)"],
    ["POST", `${PROJECT}/storage/v1/object/vedlegg/x`, "lagring"],
    ["GET", `${PROJECT}/realtime/v1/api/broadcast`, "sanntid"],
    ["POST", `${PROJECT}/graphql/v1`, "graphql"],
    ["POST", `${PROJECT}/functions/v1/x`, "funksjoner"],
    ["GET", `${PROJECT}/auth/v1/user`, "Auth: hvem er jeg (ikke begrenset per adresse)"],
    ["POST", `${PROJECT}/auth/v1/logout`, "Auth: logg ut"],
    ["POST", `${PROJECT}/auth/v1/signup`, "Auth: registrering (TING bruker den ikke)"],
    ["POST", `${PROJECT}/auth/v1/admin/generate_link`, "Auth: administrasjon"],
    ["PUT", `${PROJECT}/auth/v1/admin/users/x`, "Auth: administrasjon av en bruker"],
    ["GET", `${PROJECT}/auth/v1/admin/users`, "Auth: brukerliste"],
    ["DELETE", `${PROJECT}/auth/v1/user`, "Auth: annen metode på samme sti"],
    ["GET", `${PROJECT}/auth/v1/token`, "Auth: annen metode på token"],
    ["POST", `${PROJECT}/auth/v1/tokens`, "en sti som bare ligner"],
    ["POST", `${PROJECT}/auth/v1/token/../../rest/v1/rpc/x`, "en sti som klatrer ut"],
    ["POST", `${PROJECT}/rest/v1/auth/v1/token`, "en sti som gjemmer seg under data-API-et"],
    ["POST", `${PROJECT}/auth/v2/token`, "en annen versjon"],
    ["POST", "https://prosjekt.supabase.co.evil.example/auth/v1/token", "et vertsnavn som bare ligner"],
    ["POST", "https://evil.example/auth/v1/token", "en annen vert"],
    ["POST", "http://prosjekt.supabase.co/auth/v1/token", "samme vert uten TLS"],
    ["POST", "https://prosjekt.supabase.co:8443/auth/v1/token", "samme vert, annen port"],
    ["POST", "https://evil.example/?next=https://prosjekt.supabase.co/auth/v1/token", "prosjektadressen som parameter"],
  ];
  for (const [method, url, label] of untouched) {
    const rec = recorder();
    await withAuthForwarding(rec.fake, on)(url, { method, headers, body: method === "GET" ? undefined : "{}" });
    expect(`aldri: ${label}`, forwarded(rec.calls[0]), "offentlig/-");
    expect(`aldri: ${label} — den hemmelige nøkkelen er ikke med i noen header`, [...(rec.calls[0]?.headers.values() ?? [])].some((value) => value.includes(SECRET)), false);
  }
  const subpath = recorder();
  await withAuthForwarding(subpath.fake, { ...on, supabaseUrl: "https://vert.example/supabase/" })("https://vert.example/supabase/auth/v1/otp", { method: "POST", headers, body: "{}" });
  expect("på: et prosjekt under en understi", forwarded(subpath.calls[0]), `hemmelig/${MEMBER}`);
  const nearSubpath = recorder();
  await withAuthForwarding(nearSubpath.fake, { ...on, supabaseUrl: "https://vert.example/supabase/" })("https://vert.example/auth/v1/otp", { method: "POST", headers, body: "{}" });
  expect("aldri: samme vert utenfor understien", forwarded(nearSubpath.calls[0]), "offentlig/-");

  // ── 3. When Supabase refuses the secret key — and only then ────────────
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...parts: unknown[]) => void logged.push(parts.map(String).join(" "));
  const signIn = { method: "POST", headers, body: '{"email":"a@b.no"}' } as const;
  try {
    // The gateway says the key is not accepted: sent again the ordinary way.
    resetAuthForwardingBreaker();
    const revoked = recorder((seen) => (seen.headers.get("apikey") === SECRET ? KEY_REFUSED : 200));
    const wrapped = withAuthForwarding(revoked.fake, on);
    const first = await wrapped(`${PROJECT}/auth/v1/token?grant_type=password`, signIn);
    expect("avvist nøkkel: forespørselen lykkes likevel, på vanlig måte", first.status, 200);
    expect("avvist nøkkel: først med nøkkelen, så uten", revoked.calls.map(forwarded).join(" → "), `hemmelig/${MEMBER} → offentlig/-`);
    expect("avvist nøkkel: innholdet sendes uendret andre gang", revoked.calls[1]?.body, signIn.body);
    await wrapped(`${PROJECT}/auth/v1/token?grant_type=refresh_token`, signIn);
    await wrapped(`${PROJECT}/auth/v1/otp`, signIn);
    expect("avvist nøkkel: videresending står over etterpå — ingen flere forsøk med nøkkelen", revoked.calls.slice(2).map(forwarded).join(" "), "offentlig/- offentlig/-");
    expect("avvist nøkkel: det sies fra én gang", logged.length, 1);
    expect("avvist nøkkel: og nøkkelen står ikke i loggen", logged.join(" ").includes(SECRET), false);
    expect("avvist nøkkel: loggen sier hva som må sjekkes", /SUPABASE_SECRET_KEY/.test(logged.join(" ")), true);
    for (const message of ["Unregistered API key", "No API key found in request", "Invalid API key"]) {
      resetAuthForwardingBreaker();
      const variant = recorder((seen) => (seen.headers.get("apikey") === SECRET ? { status: 401, body: JSON.stringify({ message }) } : 200));
      const got = await withAuthForwarding(variant.fake, on)(`${PROJECT}/auth/v1/recover`, signIn);
      expect(`avvist nøkkel: «${message}» gjenkjennes`, `${got.status}/${variant.calls.length}`, "200/2");
    }

    // Everything else is Auth's answer. It is passed on as it is, once, and
    // forwarding carries on — nobody can switch it off by failing to sign in.
    const answers: [string, number | { status: number; body: string }][] = [
      ["utløpt eller manglende token (401 fra Auth)", TOKEN_REFUSED],
      ["ugyldig token (401, bad_jwt)", { status: 401, body: JSON.stringify({ code: 401, error_code: "bad_jwt", msg: "invalid JWT" }) }],
      ["Auth-feil som nevner «API key» i teksten", { status: 401, body: JSON.stringify({ code: 401, error_code: "no_authorization", msg: "Invalid API key" }) }],
      ["401 med eldre Auth-form", { status: 401, body: JSON.stringify({ error: "invalid_grant", error_description: "Invalid API key" }) }],
      ["401 om noe annet enn nøkkelen", { status: 401, body: JSON.stringify({ message: "JWT expired" }) }],
      ["401 uten innhold", { status: 401, body: "" }],
      ["401 som ikke er JSON", { status: 401, body: "<html>Invalid API key</html>" }],
      ["401 der JSON er en tekst", { status: 401, body: JSON.stringify("Invalid API key") }],
      ["feil passord (400)", { status: 400, body: JSON.stringify({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }) }],
      ["utløpt lenke (403)", { status: 403, body: JSON.stringify({ code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" }) }],
      ["403 med nøkkelmelding", { status: 403, body: JSON.stringify({ message: "Invalid API key" }) }],
      ["svakt passord (422)", { status: 422, body: JSON.stringify({ code: 422, error_code: "weak_password", msg: "Password should be at least 12 characters" }) }],
      ["for mange forespørsler (429)", { status: 429, body: JSON.stringify({ code: 429, error_code: "over_request_rate_limit", msg: "Request rate limit reached" }) }],
      ["429 med nøkkelmelding", { status: 429, body: JSON.stringify({ message: "Invalid API key" }) }],
      ["for mange e-poster (429)", { status: 429, body: JSON.stringify({ code: 429, error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" }) }],
      ["Auth nede (500)", 500],
      ["Auth utilgjengelig (503)", 503],
    ];
    for (const [label, answer] of answers) {
      resetAuthForwardingBreaker();
      logged.length = 0;
      const told = recorder((seen) => (seen.headers.get("apikey") === SECRET ? answer : 200));
      const stay = withAuthForwarding(told.fake, on);
      const got = await stay(`${PROJECT}/auth/v1/user`, { method: "PUT", headers: { ...headers, Authorization: "Bearer medlemmets-eget-token" }, body: "{}" });
      const wanted = typeof answer === "number" ? answer : answer.status;
      expect(`ikke nøkkelen: ${label} — gis videre som det er, uten nytt forsøk`, `${got.status}/${told.calls.length}`, `${wanted}/1`);
      if (typeof answer !== "number") expect(`ikke nøkkelen: ${label} — svaret kan fortsatt leses av klienten`, await got.text(), answer.body);
      await stay(`${PROJECT}/auth/v1/token?grant_type=password`, signIn);
      expect(`ikke nøkkelen: ${label} — videresending fortsetter`, forwarded(told.calls[1]), `hemmelig/${MEMBER}`);
      expect(`ikke nøkkelen: ${label} — ingenting logges`, logged.length, 0);
    }

    // A refusal that arrives on a request whose body cannot be sent twice is
    // not repeated either; forwarding still steps aside for the next one.
    resetAuthForwardingBreaker();
    logged.length = 0;
    const stream = recorder((seen) => (seen.headers.get("apikey") === SECRET ? KEY_REFUSED : 200));
    const once = withAuthForwarding(stream.fake, on);
    const unreplayed = await once(new Request(`${PROJECT}/auth/v1/recover`, { method: "POST", headers, body: "{}" }));
    expect("avvist nøkkel, Request-objekt: sendes ikke på nytt", `${unreplayed.status}/${stream.calls.length}`, "401/1");
    await once(`${PROJECT}/auth/v1/recover`, signIn);
    expect("avvist nøkkel, Request-objekt: neste forespørsel går uten nøkkelen", forwarded(stream.calls[1]), "offentlig/-");
  } finally {
    console.error = realError;
    resetAuthForwardingBreaker();
  }

  // ── 4. Where the secret key may appear in the code ──────────────────────
  const app = [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib"), "proxy.ts"].filter((path) => /\.(ts|tsx)$/.test(path));
  const read = (path: string) => readFileSync(path, "utf8");
  expect(
    "kode: nøkkelen hentes bare der en forespørsels fetch bygges",
    app.filter((path) => /supabaseSecretKey\(/.test(read(path))).sort().join(),
    [join("lib", "supabase", "env.ts"), join("lib", "supabase", "server.ts"), "proxy.ts"].sort().join(),
  );
  expect(
    "kode: miljøvariabelen leses ett sted",
    app.filter((path) => /process\.env\.SUPABASE_SECRET_KEY/.test(read(path))).join(),
    join("lib", "supabase", "env.ts"),
  );
  expect("kode: ingen NEXT_PUBLIC-variant av nøkkelen finnes", app.some((path) => /NEXT_PUBLIC_[A-Z_]*SECRET/.test(read(path))), false);
  expect(
    "kode: ingen klient opprettes med den hemmelige nøkkelen",
    app.filter((path) => /create(Server|Browser)?Client(<[^>]*>)?\([^)]*supabaseSecretKey/.test(read(path).replace(/\s+/g, " "))).join(),
    "",
  );
  const clientSide = app.filter((path) => /^\s*["']use client["']/m.test(read(path)));
  expect("kode: det finnes klientkomponenter å kontrollere", clientSide.length > 10, true);
  expect(
    "kode: ingen klientkomponent rører videresendingen, nøkkelen eller serverklientene",
    clientSide.filter((path) => /auth-forwarding|supabaseSecretKey|SUPABASE_SECRET|supabase\/(server|admin)["']/.test(read(path))).join(),
    "",
  );
  const example = read(".env.example");
  expect("miljø: variabelen er dokumentert, uten verdi", /^# SUPABASE_SECRET_KEY=\s*$/m.test(example), true);
  expect("miljø: ingen ekte nøkkel i eksempelfila", /sb_secret_[A-Za-z0-9_-]{8,}/.test(example), false);

  // ── 5. The real thing, against the local stack ──────────────────────────
  const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { stdio: ["ignore", "pipe", "ignore"] }).toString()) as Record<string, string>;
  const localSecret = status.SECRET_KEY;
  expect("lokalt: stakken har en hemmelig nøkkel av riktig slag", looksLikeSecretKey(localSecret), true);
  if (!looksLikeSecretKey(localSecret)) return;

  // What a built bundle must not contain. (Skipped only if nothing is built.)
  const bundles = sourceFiles(join(".next", "static"));
  if (bundles.length > 0) {
    expect("bygg: nøkkelen er ikke i noe som sendes til nettlesere", bundles.some((path) => read(path).includes(localSecret) || /SUPABASE_SECRET_KEY/.test(read(path))), false);
    expect("bygg: service_role-nøkkelen er der heller ikke", bundles.some((path) => read(path).includes(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "∅")), false);
  }

  const admin = createSupabaseAdminClient();
  const wire: { path: string; key: string; address: string | null; bearer: string }[] = [];
  const watching: typeof fetch = async (input, init) => {
    const sent = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const bearer = sent.get("authorization") ?? "";
    wire.push({
      path: new URL(input instanceof Request ? input.url : String(input)).pathname,
      key: sent.get("apikey") === localSecret ? "hemmelig" : sent.get("apikey") === supabaseAnonKey() ? "offentlig" : "annet",
      address: sent.get("sb-forwarded-for"),
      bearer: bearer === `Bearer ${supabaseAnonKey()}` ? "offentlig" : bearer.includes(localSecret) ? "HEMMELIG" : bearer ? "medlem" : "ingen",
    });
    return fetch(input, init);
  };
  /** A client built the way lib/supabase/server.ts builds one, for a caller at `address`. */
  const clientAt = (address: string | undefined, secretKey: string | undefined = localSecret) =>
    createClient<Database>(supabaseUrl(), supabaseAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: withAuthForwarding(watching, { supabaseUrl: supabaseUrl(), secretKey, clientAddress: address }) },
    });
  const since = () => wire.length;
  const seen = (from: number, path: string) => wire.slice(from).filter((entry) => entry.path.endsWith(path));

  const made: string[] = [];
  const email = `check.forward.${randomUUID().slice(0, 8)}@demo.join-ting.no`;
  const password = `${randomUUID()} passfrase`;
  try {
    const { data: created } = await admin.auth.admin.createUser({ email, email_confirm: true });
    made.push(created.user!.id);
    const { data: fixture } = await admin.from("memberships").select("user_id, community_id").eq("status", "active").limit(1).single();

    // An emailed link, redeemed with forwarding on.
    const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const member = clientAt(MEMBER);
    let mark = since();
    const linked = await member.auth.verifyOtp({ type: "email", token_hash: link!.properties!.hashed_token });
    expect("lenke: innlogging med videresending virker", linked.data.user?.id, created.user!.id);
    expect("lenke: forespørselen bar nøkkelen og adressen", `${seen(mark, "/verify")[0]?.key}/${seen(mark, "/verify")[0]?.address}`, `hemmelig/${MEMBER}`);

    // The member's first password, then signing in with it.
    mark = since();
    expect("passord: opprettes med videresending", (await member.auth.updateUser({ password })).error, null);
    const put = seen(mark, "/user")[0];
    expect("passord: endringen bar nøkkelen, adressen og medlemmets eget token", `${put?.key}/${put?.address}/${put?.bearer}`, `hemmelig/${MEMBER}/medlem`);
    const elsewhere = clientAt("198.51.100.20");
    mark = since();
    const signedIn = await elsewhere.auth.signInWithPassword({ email, password });
    expect("passord: innlogging fra en annen adresse virker", signedIn.data.user?.id, created.user!.id);
    expect("passord: og bærer den adressen", seen(mark, "/token")[0]?.address, "198.51.100.20");
    expect("passord: feil passord avvises som før", (await clientAt("198.51.100.21").auth.signInWithPassword({ email, password: `${randomUUID()} feil` })).error?.code, "invalid_credentials");

    // The session is the member's own, and nothing more.
    const claims = JSON.parse(Buffer.from(signedIn.data.session!.access_token.split(".")[1], "base64url").toString());
    expect("sesjon: rollen er et vanlig medlems", claims.role, "authenticated");
    expect("sesjon: og tilhører riktig konto", claims.sub, created.user!.id);
    mark = since();
    expect("sesjon: kan ikke liste brukere", Boolean((await elsewhere.auth.admin.listUsers()).error), true);
    expect("sesjon: administrasjonskallet bar ikke nøkkelen", wire.slice(mark).every((entry) => entry.key === "offentlig"), true);

    // The data API: public key, the member's token, and row level security as always.
    mark = since();
    const own = await elsewhere.from("profiles").select("id");
    const foreign = await elsewhere.from("memberships").select("id").eq("community_id", fixture!.community_id);
    const isMember = await elsewhere.rpc("is_member", { cid: fixture!.community_id });
    const security = await elsewhere.from("account_security").select("user_id");
    const throttle = await elsewhere.from("auth_throttle").select("key");
    const forged = await elsewhere.from("memberships").insert({ user_id: created.user!.id, community_id: fixture!.community_id, role: "admin", status: "active" }).select();
    expect("RLS: ser bare sin egen kontorad", (own.data ?? []).map((row) => row.id).join(), created.user!.id);
    expect("RLS: ser ingen medlemskap i et fellesskap den ikke er med i", (foreign.data ?? []).length, 0);
    expect("RLS: er ikke medlem", isMember.data, false);
    expect("RLS: ser bare sin egen sikkerhetsrad", (security.data ?? []).map((row) => row.user_id).join(), created.user!.id);
    expect("RLS: tellerne er utilgjengelige", (throttle.data ?? []).length, 0);
    expect("RLS: kan ikke gi seg selv et medlemskap", (forged.data ?? []).length, 0);
    const dataCalls = wire.slice(mark).filter((entry) => entry.path.includes("/rest/v1/"));
    expect("RLS: seks dataforespørsler ble sett", dataCalls.length, 6);
    expect("RLS: ingen av dem bar den hemmelige nøkkelen eller en adresse", dataCalls.every((entry) => entry.key === "offentlig" && entry.address === null && entry.bearer === "medlem"), true);
    // The same questions without forwarding get the same answers.
    const ordinary = clientAt(undefined);
    await ordinary.auth.signInWithPassword({ email, password });
    expect("RLS: samme svar uten videresending", JSON.stringify([(await ordinary.from("profiles").select("id")).data, (await ordinary.rpc("is_member", { cid: fixture!.community_id })).data]), JSON.stringify([own.data, isMember.data]));

    // Refreshing the session — the call a member's browser causes most often.
    mark = since();
    const refreshed = await elsewhere.auth.refreshSession();
    expect("fornyelse: virker med videresending", refreshed.data.user?.id, created.user!.id);
    const refreshCall = seen(mark, "/token")[0];
    expect("fornyelse: bar nøkkelen og adressen", `${refreshCall?.key}/${refreshCall?.address}`, "hemmelig/198.51.100.20");
    expect("fornyelse: sesjonen er fortsatt medlemmets", (await elsewhere.auth.getUser()).data.user?.id, created.user!.id);
    mark = since();
    expect("fornyelse: et oppdiktet fornyelsestoken avvises som før", Boolean((await clientAt("198.51.100.66").auth.refreshSession({ refresh_token: "ikke-et-token" })).error), true);
    expect("fornyelse: også det forsøket telles på avsenderens egen adresse", seen(mark, "/token")[0]?.address, "198.51.100.66");

    // Emailed links and password reset requests. (Auth sends one email per
    // account per second locally; stay clear of that.)
    const breathe = () => new Promise((resolve) => setTimeout(resolve, 1200));
    await breathe();
    mark = since();
    expect("e-postlenke: forespørselen går gjennom", (await clientAt("198.51.100.30").auth.signInWithOtp({ email, options: { shouldCreateUser: false } })).error, null);
    expect("e-postlenke: bar adressen", seen(mark, "/otp")[0]?.address, "198.51.100.30");
    await breathe();
    mark = since();
    expect("glemt passord: forespørselen går gjennom", (await clientAt("198.51.100.31").auth.resetPasswordForEmail(email)).error, null);
    expect("glemt passord: bar adressen", seen(mark, "/recover")[0]?.address, "198.51.100.31");

    // Never, on any request to Auth, was the secret key sent as the bearer.
    expect("aldri: den hemmelige nøkkelen som Authorization", wire.some((entry) => entry.bearer === "HEMMELIG"), false);
    expect("aldri: en adresse på en forespørsel uten nøkkelen", wire.some((entry) => entry.address !== null && entry.key !== "hemmelig"), false);

    // Signing out ends the session, forwarding or not.
    expect("utlogging: virker", (await elsewhere.auth.signOut()).error, null);
    expect("utlogging: sesjonen kan ikke fornyes etterpå", Boolean((await elsewhere.auth.refreshSession()).error), true);

    // A secret key Supabase refuses cannot be produced here: the local gateway
    // does not check the key on Auth routes, as the hosted one does. What the
    // app does when it is refused is part 3, against a gateway that answers 401.
  } finally {
    for (const id of made) await admin.auth.admin.deleteUser(id);
    const { data: key } = await admin.rpc("password_throttle_key", { p_email: email });
    await admin.from("auth_throttle").delete().eq("key", key as string);
  }
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(() => {
    if (failures > 0) {
      console.error(`\n✗ ${failures} av ${checks} kontroller av adressevideresending feilet.\n`);
      process.exit(1);
    }
    console.log(`✓ ${checks} kontroller av adressevideresending passerte`);
  });
