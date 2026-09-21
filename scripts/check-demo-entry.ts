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
 */

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
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
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

const validShowcases = [
  {
    label: "UTR admin / Octavio",
    env: "DEMO_TOKEN_UTR_ADMIN",
    landing: "/community/under-the-rug",
    adminCommunity: "under-the-rug",
    canAdmin: true,
  },
  {
    label: "FTR admin / Lars Bror",
    env: "DEMO_TOKEN_FTR_ADMIN",
    landing: "/community/tryggere-ruspolitikk",
    adminCommunity: "tryggere-ruspolitikk",
    canAdmin: true,
  },
  {
    label: "TU admin / Emma",
    env: "DEMO_TOKEN_TU_ADMIN",
    landing: "/community/tryggere-ungdom",
    adminCommunity: "tryggere-ungdom",
    canAdmin: true,
  },
  {
    label: "UTR moderator / Robin",
    env: "DEMO_TOKEN_UTR",
    landing: "/community/under-the-rug",
    adminCommunity: "under-the-rug",
    canAdmin: false,
  },
  {
    label: "Tryggere moderator / Kari",
    env: "DEMO_TOKEN_TRYGGERE",
    landing: "/community/tryggere-ruspolitikk",
    adminCommunity: "tryggere-ruspolitikk",
    canAdmin: false,
  },
  {
    label: "UTR member / Mina",
    env: "DEMO_TOKEN_UTR_MEMBER",
    landing: "/community/under-the-rug",
    adminCommunity: "under-the-rug",
    canAdmin: false,
  },
  {
    label: "Tryggere member / Eli",
    env: "DEMO_TOKEN_TRYGGERE_MEMBER",
    landing: "/community/tryggere-ruspolitikk",
    adminCommunity: "tryggere-ruspolitikk",
    canAdmin: false,
  },
] as const;

async function checkValidShowcases() {
  const configured = validShowcases.filter((showcase) => token(showcase.env).length > 0);
  if (configured.length === 0) {
    check("valid showcase checks skipped unless demo tokens are supplied", true);
    return;
  }
  check(
    "all showcase tokens are supplied for valid-entry checks",
    configured.length === validShowcases.length,
    `got ${configured.map((showcase) => showcase.env).join(", ")}`,
  );

  for (const showcase of configured) {
    const { response, jar } = await enter(token(showcase.env));
    check(`[${showcase.label}] redirects`, response.status >= 300 && response.status < 400, `got ${response.status}`);
    check(
      `[${showcase.label}] lands in intended community`,
      response.headers.get("location")?.endsWith(showcase.landing) === true,
      response.headers.get("location") ?? "(no location)",
    );
    check(`[${showcase.label}] sets a session cookie`, cookieHeader(jar).includes("sb-"), cookieHeader(jar));

    const landing = await fetchWithJar(showcase.landing, jar);
    check(`[${showcase.label}] landing opens`, landing.response.status === 200, `got ${landing.response.status}`);

    const members = await fetchWithJar(`/community/${showcase.adminCommunity}/members`, jar);
    check(`[${showcase.label}] member page opens`, members.response.status === 200, `got ${members.response.status}`);
    check(
      `[${showcase.label}] role-management visibility is correct`,
      members.body.includes("Medlemsadministrasjon") === showcase.canAdmin,
      showcase.canAdmin ? "admin controls missing" : "admin controls visible",
    );

    const requests = await fetchWithJar(`/community/${showcase.adminCommunity}/requests`, jar);
    check(`[${showcase.label}] request page opens`, requests.response.status === 200, `got ${requests.response.status}`);
    check(
      `[${showcase.label}] request queue access is correct`,
      requests.body.includes("Kun for administratorer") !== showcase.canAdmin,
      showcase.canAdmin ? "admin was refused" : "non-admin saw admin queue",
    );

    const links = await fetchWithJar(`/community/${showcase.adminCommunity}/organization-links`, jar);
    check(`[${showcase.label}] account-link page opens`, links.response.status === 200, `got ${links.response.status}`);
    check(
      `[${showcase.label}] account-link access is correct`,
      links.body.includes("Kun for administratorer") !== showcase.canAdmin,
      showcase.canAdmin ? "admin was refused" : "non-admin saw account-link controls",
    );
  }

  const switched = new Map<string, string>();
  await enter(token("DEMO_TOKEN_FTR_ADMIN"), switched);
  await enter(token("DEMO_TOKEN_TRYGGERE_MEMBER"), switched);
  const afterSwitch = await fetchWithJar("/community/tryggere-ruspolitikk/requests", switched);
  check("switching from admin token to member token drops stale admin privilege", afterSwitch.body.includes("Kun for administratorer"), "member still had admin access");

  const ftrAdmin = (await enter(token("DEMO_TOKEN_FTR_ADMIN"))).jar;
  const crossCommunity = await fetchWithJar("/community/tryggere-ungdom/requests", ftrAdmin);
  check(
    "FTR admin has no TU admin leakage",
    crossCommunity.response.status !== 200 ||
      crossCommunity.body.includes("Kun for administratorer") ||
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
