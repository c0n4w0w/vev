/**
 * Sets up a fully local demo for reviewers: local Supabase only, synthetic
 * fixtures, no hosted credentials.
 *
 *   npx supabase start        # first: starts the local stack and replays every migration
 *   npm run demo:local        # then: writes .env.local if missing, seeds, prints the accounts
 *
 * It refuses to touch anything that is not the local Supabase stack that
 * `npx supabase start` is running from this checkout:
 *
 * - The stack's address comes from `supabase status`, and must be a loopback
 *   address (127.0.0.1, localhost, ::1).
 * - If `.env.local` (or the process environment) already names a Supabase URL
 *   or service key, both must be exactly the local stack's. A hosted URL or a
 *   hosted key stops the script before any client is created.
 * - An existing `.env.local` is never modified. Only a missing one is written.
 *
 * The seed itself is `scripts/seed.ts`, unchanged. It deletes and rewrites
 * application rows, so run this against a stack you are happy to refill — the
 * point of the checks above is that it can only ever be a local one.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";
import { memberships } from "@/lib/mock/communities";
import { demoPersonaMemberships, demoPersonas } from "@/lib/mock/demo-personas";
import { localGroupManagers } from "@/lib/mock/local-groups";
import { subgroupManagers } from "@/lib/mock/subgroups";
import { users } from "@/lib/mock/users";
import { showcases, tokenEnvName } from "@/lib/demo/showcase";

const ENV_FILE = ".env.local";
const APP_URL = "http://localhost:3000";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function stop(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function isLoopback(url: string): boolean {
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Same stack whether written as localhost or 127.0.0.1. */
function sameLocalUrl(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return isLoopback(a) && isLoopback(b) && x.port === y.port && x.protocol === y.protocol;
  } catch {
    return false;
  }
}

interface LocalStack {
  apiUrl: string;
  anonKey: string;
  serviceKeys: string[];
  mailUrl?: string;
}

function readLocalStack(): LocalStack {
  const result = spawnSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8" });
  if (result.status !== 0) {
    stop(
      "Fant ingen lokal Supabase-stakk. Start den med `npx supabase start` i denne mappen " +
        "(krever Docker eller Colima), og kjør så denne kommandoen igjen.",
    );
  }
  const start = result.stdout.indexOf("{");
  let status: Record<string, string>;
  try {
    status = JSON.parse(result.stdout.slice(start));
  } catch {
    stop("Kunne ikke lese utskriften fra `supabase status -o json`.");
  }

  const apiUrl = status.API_URL;
  const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
  const serviceKeys = [status.SERVICE_ROLE_KEY, status.SECRET_KEY].filter(Boolean);
  if (!apiUrl || !anonKey || serviceKeys.length === 0) {
    stop("`supabase status` mangler API_URL eller nøklene. Er stakken ferdig startet?");
  }
  if (!isLoopback(apiUrl)) {
    stop(`Supabase-stakken svarer på ${new URL(apiUrl).host}, ikke på en lokal adresse. Avbryter.`);
  }
  return { apiUrl, anonKey, serviceKeys, mailUrl: status.MAILPIT_URL ?? status.INBUCKET_URL };
}

function token(): string {
  return randomBytes(32).toString("base64url");
}

function writeEnvFile(stack: LocalStack) {
  const lines = [
    "# Written by `npm run demo:local` for a local demo. Local stack only — no hosted values.",
    "TING_MODE=demo",
    `SITE_URL=${APP_URL}`,
    `NEXT_PUBLIC_SUPABASE_URL=${stack.apiUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${stack.anonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${stack.serviceKeys[0]}`,
    "EMAIL_PROVIDER=fil",
    ...(stack.mailUrl ? [`LOCAL_MAIL_CATCHER_URL=${stack.mailUrl}`] : []),
    "",
    "# Local showcase entry links: /demo/<token>. Generated per checkout.",
    ...showcases.map((showcase) => `${tokenEnvName(showcase)}=${token()}`),
    "",
  ];
  writeFileSync(ENV_FILE, lines.join("\n"), { mode: 0o600, flag: "wx" });
}

/**
 * The values the seed will actually use: the process environment wins over
 * the file, exactly as dotenv does it.
 */
function effectiveEnv(): Record<string, string | undefined> {
  const file = existsSync(ENV_FILE) ? parse(readFileSync(ENV_FILE)) : {};
  return { ...file, ...process.env };
}

function assertLocalTarget(env: Record<string, string | undefined>, stack: LocalStack) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !sameLocalUrl(url, stack.apiUrl)) {
    stop(
      `NEXT_PUBLIC_SUPABASE_URL peker ikke på den lokale stakken (${stack.apiUrl}). ` +
        "Denne kommandoen kjører bare mot lokal Supabase. Rett .env.local, eller flytt den bort " +
        "og kjør igjen for å få en ny.",
    );
  }
  if (!key || !stack.serviceKeys.includes(key)) {
    stop(
      "SUPABASE_SERVICE_ROLE_KEY er ikke nøkkelen til den lokale stakken. " +
        "Denne kommandoen kjører bare mot lokal Supabase; ingen hostet nøkkel brukes.",
    );
  }
}

function printSummary(env: Record<string, string | undefined>, stack: LocalStack) {
  const everyone = [...users, ...demoPersonas];
  const byId = new Map(everyone.map((user) => [user.id, user]));
  const label = (id: string) => {
    const user = byId.get(id);
    return user ? `${user.handle.padEnd(16)} ${user.email}` : id;
  };

  console.log("\n── Lokal demo klar ──────────────────────────────────────────────");
  console.log(`App:     ${APP_URL}   (start med \`npm run dev\`)`);
  if (stack.mailUrl) console.log(`Mailpit: ${stack.mailUrl}   (all e-post fra lokal Auth og TING lander her)`);

  console.log("\nInnlogging med showcase-lenke (krever TING_MODE=demo, som .env.local har):");
  for (const showcase of showcases) {
    const value = env[tokenEnvName(showcase)];
    const link = value && value.length >= 24 ? `${APP_URL}/demo/${value}` : `(mangler ${tokenEnvName(showcase)})`;
    console.log(`  ${showcase.label}`);
    console.log(`    ${showcase.personaEmail}`);
    console.log(`    ${link}`);
  }

  console.log("\nAlle andre kontoer: /login → «Logg inn med e-postlenke», åpne lenken i Mailpit.");
  console.log("Kontoene har ikke passord; et passord kan settes under Kontoen din → Sikkerhet.\n");

  const communities = [...new Set([...memberships, ...demoPersonaMemberships].map((m) => m.communityId))];
  for (const communityId of communities) {
    console.log(`${communityId}`);
    const rows = [...memberships, ...demoPersonaMemberships].filter(
      (m) => m.communityId === communityId && m.status === "active",
    );
    for (const role of ["admin", "moderator", "member"] as const) {
      for (const m of rows.filter((row) => row.role === role)) {
        console.log(`  ${role.padEnd(10)} ${label(m.userId)}`);
      }
    }
    for (const m of localGroupManagers.filter((row) => row.communityId === communityId)) {
      console.log(`  ${"lokallag".padEnd(10)} ${label(m.userId)}   leder for ${m.localGroupName}`);
    }
    for (const m of subgroupManagers.filter((row) => row.communityId === communityId)) {
      console.log(`  ${"gruppe".padEnd(10)} ${label(m.userId)}   leder for ${m.subgroupSlug}`);
    }
    const pending = [...memberships, ...demoPersonaMemberships].filter(
      (m) => m.communityId === communityId && m.status !== "active",
    );
    for (const m of pending) console.log(`  ${m.status.padEnd(10)} ${label(m.userId)}`);
  }
  const withoutCommunity = everyone.filter(
    (user) => ![...memberships, ...demoPersonaMemberships].some((m) => m.userId === user.id),
  );
  for (const user of withoutCommunity) console.log(`ingen fellesskap\n  ${"–".padEnd(10)} ${label(user.id)}`);
  console.log("");
}

function main() {
  const skipSeed = process.argv.includes("--no-seed");
  const stack = readLocalStack();

  // Values already in the shell are checked too: dotenv never overrides them,
  // so a hosted URL exported in the terminal would otherwise win silently.
  const preset = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!existsSync(ENV_FILE)) {
    if (preset) assertLocalTarget(process.env, stack);
    writeEnvFile(stack);
    console.log(`✓ Skrev ${ENV_FILE} med verdiene til den lokale stakken og nye showcase-lenker.`);
  } else {
    console.log(`• ${ENV_FILE} finnes allerede og endres ikke.`);
  }

  const env = effectiveEnv();
  assertLocalTarget(env, stack);
  if (env.TING_MODE?.trim().toLowerCase() !== "demo") {
    console.log("• TING_MODE er ikke «demo» i miljøet: showcase-lenkene virker ikke før den settes.");
  }

  if (!skipSeed) {
    console.log("• Fyller den lokale databasen med syntetiske testdata (scripts/seed.ts) …");
    const seed = spawnSync("npx", ["tsx", "scripts/seed.ts"], {
      stdio: "inherit",
      // Only after the target has been proved local: the seed's own guard is
      // TING_MODE, which a local demo always wants.
      env: { ...process.env, ...env, TING_MODE: "demo" } as NodeJS.ProcessEnv,
    });
    if (seed.status !== 0) stop("Seeden feilet; se utskriften over.");
  }

  printSummary(env, stack);
}

main();
