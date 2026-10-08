/**
 * The showcase entry route, checked at the HTTP level.
 *
 * Two things matter here and neither is visible from a unit test:
 *
 *  1. A rejected token gets a *page*, not a blank screen. This route answered
 *     404 with an empty body until it was fixed; the browser showed white.
 *  2. Every rejection is identical. The reason a token failed — demo mode off,
 *     wrong token, unseeded database — must not be recoverable from the
 *     response, in the body, the headers or the status.
 *
 * Run against a dev or preview server: `npm run check:demo-entry`.
 *
 * The valid-token half reads the same `.env.local` the server does. It used
 * to read only the shell environment, so it silently skipped every valid
 * token and passed while every demo link was a 404 — because a showcase whose
 * Supabase is down or unseeded is rejected exactly like a wrong token, which
 * the rejection checks above are built to accept. On a demo deployment the
 * valid tokens are therefore required, not optional.
 */
import { config } from "dotenv";
import { findShowcase, showcases, tokenEnvName, type Showcase } from "@/lib/demo/showcase";
import { common as enCommon } from "@/lib/i18n/en/common";
import { common as nbCommon } from "@/lib/i18n/nb/common";

config({ path: ".env.local" });
config({ path: ".env" });

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(detail ? `${label} — ${detail}` : label);
}

/**
 * Tokens that fail for different reasons, and must be indistinguishable.
 *
 * An empty token is deliberately not in this list: `/demo/` normalises to
 * `/demo`, which matches no route at all and never reaches the handler. It is
 * checked separately, against the app's ordinary 404.
 */
const rejected = [
  ["too short", "kort"],
  ["right length, wrong value", "a".repeat(32)],
  ["right length, different wrong value", "b".repeat(48)],
  ["looks like a path", "..%2F..%2Fetc%2Fpasswd"],
  ["html in the token", "%3Cscript%3Ealert(1)%3C%2Fscript%3E" + "a".repeat(24)],
] as const;

type Probe = { label: string; status: number; body: string; contentType: string; cache: string };
type CookieJar = Map<string, string>;

async function probe(label: string, token: string): Promise<Probe> {
  const response = await fetch(`${BASE}/demo/${token}`, { redirect: "manual" });
  return {
    label,
    status: response.status,
    body: await response.text(),
    contentType: response.headers.get("content-type") ?? "",
    cache: response.headers.get("cache-control") ?? "",
  };
}

function token(name: string) {
  return process.env[name] ?? "";
}

function setCookies(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (getSetCookie) return getSetCookie.call(headers);
  const combined = headers.get("set-cookie");
  if (!combined) return [];
  return [combined];
}

function storeCookies(jar: CookieJar, headers: Headers) {
  for (const cookie of setCookies(headers)) {
    const pair = cookie.split(";", 1)[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    // A browser drops a cookie the server expires; so must this jar, or a
    // stale session chunk would survive a persona switch here and not there.
    if (!value || /;\s*max-age=0\b/i.test(cookie)) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader(jar: CookieJar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function enter(tokenValue: string, jar = new Map<string, string>()) {
  const response = await fetch(`${BASE}/demo/${tokenValue}`, {
    redirect: "manual",
    headers: cookieHeader(jar) ? { Cookie: cookieHeader(jar) } : undefined,
  });
  storeCookies(jar, response.headers);
  return { response, jar };
}

async function fetchWithJar(path: string, jar: CookieJar) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: { Cookie: cookieHeader(jar) },
  });
  return { response, body: await response.text() };
}

/**
 * What each showcase persona should be able to do once inside.
 *
 * Keyed by showcase id so the persona's email and landing come from
 * `lib/demo/showcase.ts` — what the route actually uses — rather than a second
 * copy here that can drift. `memberOf` is every private community the persona
 * belongs to; every other one must turn them away.
 */
type Expectation = {
  label: string;
  adminCommunity: string;
  canAdmin: boolean;
  memberOf: string[];
};

const expectations: Record<Showcase["id"], Expectation> = {
  utr_admin: {
    label: "UTR admin / Octavio",
    adminCommunity: "under-the-rug",
    canAdmin: true,
    memberOf: ["under-the-rug"],
  },
  ftr_admin: {
    label: "FTR admin / Mia",
    adminCommunity: "tryggere-ruspolitikk",
    canAdmin: true,
    memberOf: ["tryggere-ruspolitikk"],
  },
  tu_admin: {
    label: "TU admin / Emma",
    adminCommunity: "tryggere-ungdom",
    canAdmin: true,
    memberOf: ["tryggere-ungdom"],
  },
  utr: {
    label: "UTR moderator / Robin",
    adminCommunity: "under-the-rug",
    canAdmin: false,
    memberOf: ["under-the-rug"],
  },
  tryggere: {
    label: "Tryggere moderator / Kari",
    adminCommunity: "tryggere-ruspolitikk",
    canAdmin: false,
    memberOf: ["tryggere-ruspolitikk", "tryggere-ungdom"],
  },
  utr_member: {
    label: "UTR member / Mina",
    adminCommunity: "under-the-rug",
    canAdmin: false,
    memberOf: ["under-the-rug"],
  },
  tryggere_member: {
    label: "Tryggere member / Eli",
    adminCommunity: "tryggere-ruspolitikk",
    canAdmin: false,
    memberOf: ["tryggere-ruspolitikk", "tryggere-ungdom"],
  },
};

const privateCommunities = ["under-the-rug", "tryggere-ruspolitikk", "tryggere-ungdom"];

/**
 * The refusal an admin-only page shows, in whichever locale the community
 * uses. Read from the dictionaries so a copy change cannot quietly turn these
 * checks into ones that always pass or always fail.
 */
const adminsOnly = [nbCommon["common.adminsOnly"], enCommon["common.adminsOnly"]];
const refused = (body: string) => adminsOnly.some((copy) => body.includes(copy));

/**
 * The email of the account the session cookie belongs to.
 *
 * A redirect and an `sb-` cookie only prove *someone* was signed in. The
 * persona is the point of a showcase, so read it back out of the session.
 */
function sessionEmail(jar: CookieJar): string | undefined {
  const chunk = (name: string) => Number(name.match(/\.(\d+)$/)?.[1] ?? -1);
  const names = [...jar.keys()]
    .filter((name) => /^sb-.+-auth-token(\.\d+)?$/.test(name))
    .sort((a, b) => chunk(a) - chunk(b));
  if (names.length === 0) return undefined;
  let raw = names.map((name) => jar.get(name) ?? "").join("");
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8");
  try {
    return JSON.parse(raw)?.user?.email;
  } catch {
    return undefined;
  }
}

function showcaseToken(id: Showcase["id"]) {
  const showcase = findShowcase(id);
  return showcase ? token(tokenEnvName(showcase)) : "";
}

async function checkValidShowcases() {
  const demoMode = process.env.TING_MODE?.trim().toLowerCase() === "demo";
  const configured = showcases.filter((showcase) => token(tokenEnvName(showcase)).length > 0);
  if (!demoMode && configured.length === 0) {
    console.log("note: TING_MODE is not demo — valid showcase entry not checked");
    return;
  }
  check(
    "every showcase has an entry token configured",
    configured.length === showcases.length,
    `missing ${showcases
      .filter((showcase) => !configured.includes(showcase))
      .map(tokenEnvName)
      .join(", ")}`,
  );

  for (const showcase of configured) {
    const expected = expectations[showcase.id];
    const label = `[${expected.label}]`;
    const { response, jar } = await enter(token(tokenEnvName(showcase)));
    const entered = response.status >= 300 && response.status < 400;
    check(
      `${label} redirects`,
      entered,
      response.status === 404
        ? "got 404: a configured token was rejected. The dev server logs why as `[demo] …`; " +
            "usually Supabase is unreachable (is Docker running? `npx supabase start`) " +
            "or the database is unseeded (`npm run seed`)"
        : `got ${response.status}`,
    );
    if (!entered) continue;

    check(
      `${label} lands in intended community`,
      response.headers.get("location")?.endsWith(showcase.landing) === true,
      response.headers.get("location") ?? "(no location)",
    );
    check(`${label} sets a session cookie`, cookieHeader(jar).includes("sb-"), cookieHeader(jar));
    const signedInAs = sessionEmail(jar);
    check(
      `${label} is signed in as ${showcase.personaEmail}`,
      signedInAs === showcase.personaEmail,
      `session belongs to ${signedInAs ?? "(nobody)"}`,
    );

    const landing = await fetchWithJar(showcase.landing, jar);
    check(`${label} landing opens`, landing.response.status === 200, `got ${landing.response.status}`);

    const members = await fetchWithJar(`/community/${expected.adminCommunity}/members`, jar);
    check(`${label} member page opens`, members.response.status === 200, `got ${members.response.status}`);

    const memberAdmin = await fetchWithJar(`/community/${expected.adminCommunity}/admin/members`, jar);
    check(`${label} member-admin page opens`, memberAdmin.response.status === 200, `got ${memberAdmin.response.status}`);
    check(
      `${label} member-admin access is correct`,
      refused(memberAdmin.body) !== expected.canAdmin,
      expected.canAdmin ? "admin was refused" : "non-admin saw member administration",
    );

    const requests = await fetchWithJar(`/community/${expected.adminCommunity}/requests`, jar);
    check(`${label} request page opens`, requests.response.status === 200, `got ${requests.response.status}`);
    check(
      `${label} request queue access is correct`,
      refused(requests.body) !== expected.canAdmin,
      expected.canAdmin ? "admin was refused" : "non-admin saw admin queue",
    );

    const links = await fetchWithJar(`/community/${expected.adminCommunity}/organization-links`, jar);
    check(`${label} account-link page opens`, links.response.status === 200, `got ${links.response.status}`);
    check(
      `${label} account-link access is correct`,
      refused(links.body) !== expected.canAdmin,
      expected.canAdmin ? "admin was refused" : "non-admin saw account-link controls",
    );

    for (const other of privateCommunities.filter((slug) => !expected.memberOf.includes(slug))) {
      const foreign = await fetchWithJar(`/community/${other}`, jar);
      check(`${label} is turned away from ${other}`, foreign.response.status !== 200, "got 200");
    }
  }

  const ftrAdminToken = showcaseToken("ftr_admin");
  const memberToken = showcaseToken("tryggere_member");
  if (!ftrAdminToken || !memberToken) return;

  const switched = new Map<string, string>();
  await enter(ftrAdminToken, switched);
  await enter(memberToken, switched);
  check(
    "switching from admin token to member token switches the account",
    sessionEmail(switched) === findShowcase("tryggere_member")?.personaEmail,
    `session belongs to ${sessionEmail(switched) ?? "(nobody)"}`,
  );
  const afterSwitch = await fetchWithJar("/community/tryggere-ruspolitikk/requests", switched);
  check("switching from admin token to member token drops stale admin privilege", refused(afterSwitch.body), "member still had admin access");

  const ftrAdmin = (await enter(ftrAdminToken)).jar;
  const crossCommunity = await fetchWithJar("/community/tryggere-ungdom/requests", ftrAdmin);
  check(
    "FTR admin has no TU admin leakage",
    crossCommunity.response.status !== 200 ||
      refused(crossCommunity.body) ||
      !crossCommunity.body.includes("Folk som har bedt om tilgang til Tryggere Ungdom"),
    "FTR admin reached TU admin queue",
  );
}

async function main() {
  const probes: Probe[] = [];
  for (const [label, token] of rejected) probes.push(await probe(label, token));

  for (const p of probes) {
    check(`[${p.label}] answers 404`, p.status === 404, `got ${p.status}`);
    check(`[${p.label}] has a body`, p.body.length > 0, "empty body — blank page");
    check(
      `[${p.label}] is HTML`,
      p.contentType.startsWith("text/html"),
      `content-type ${p.contentType || "(none)"}`,
    );
    check(
      `[${p.label}] is not cached`,
      p.cache.includes("no-store"),
      `cache-control ${p.cache || "(none)"}`,
    );
    check(
      `[${p.label}] says what a 404 says`,
      p.body.includes("Vi finner ikke denne siden"),
      "the shared 404 copy is missing",
    );
    check(
      `[${p.label}] offers a way out`,
      p.body.includes('href="/"'),
      "no link back to the front page",
    );
    check(
      `[${p.label}] does not echo the token`,
      !p.body.includes("script>alert") && !p.body.includes("etc%2Fpasswd"),
      "request content was reflected into the page",
    );
  }

  // The point of the exercise: no rejection is distinguishable from another.
  const [first, ...rest] = probes;
  for (const other of rest) {
    check(
      `[${other.label}] is byte-identical to [${first.label}]`,
      other.body === first.body && other.status === first.status,
      "a prober could tell these two rejections apart",
    );
  }

  // A page, not a fragment — this is served without the app's stylesheet.
  check("the document stands alone", first.body.startsWith("<!doctype html>"));
  check("the document carries its own styles", first.body.includes("<style>"));
  check("the document is not indexable", first.body.includes('name="robots"'));
  check(
    "the tab is titled like the app's own 404",
    first.body.includes("<title>Ikke funnet · TING</title>"),
    "a history entry would read as though the page loaded",
  );

  // No token at all is a different path: it matches no route, so the app's own
  // 404 answers. Different markup, same words — which is the whole arrangement.
  const bare = await fetch(`${BASE}/demo`);
  const bareBody = await bare.text();
  check("no token at all answers 404", bare.status === 404, `got ${bare.status}`);
  check(
    "no token at all reaches the app's own 404",
    bareBody.includes("Vi finner ikke denne siden"),
    "the shared 404 copy is missing",
  );

  await checkValidShowcases();

  const total = passed + failures.length;
  if (failures.length > 0) {
    console.error(`check:demo-entry — ${passed}/${total} passed\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log(`check:demo-entry — ${total}/${total} passed`);
}

main().catch((error) => {
  console.error(`check:demo-entry could not run against ${BASE}`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
