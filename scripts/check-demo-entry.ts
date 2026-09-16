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
