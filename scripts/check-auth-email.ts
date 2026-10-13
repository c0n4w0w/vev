/**
 * Checks TING's sign-in email: the Supabase Auth template GoTrue sends for a
 * normal passwordless sign-in — and that the other emails Auth sends for an
 * account (password reset, email-change confirmation, and the two notices
 * after a change) are the same design, wired up, and link only to TING.
 *
 * Run with `npm run check:auth-email` against the local stack. Two halves:
 *
 * - The template files and their wiring (supabase/templates/*.html,
 *   supabase/config.toml): one Supabase link variable and nothing hand-built,
 *   no community branding, nothing loaded from elsewhere, and the same
 *   palette and type as the approval email (EMAIL_STYLE) — they are
 *   rendered by different systems and this is what keeps them one design.
 * - The real thing: an ordinary `signInWithOtp` for a throwaway existing
 *   account and a throwaway new address, read back from Mailpit — sender,
 *   subject, copy — and the link used once (it signs in) and again (refused).
 *
 * The service role only creates and removes the throwaway accounts. No token
 * or link is printed.
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { EMAIL_LOGO, EMAIL_STYLE } from "@/lib/email/invitation";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();
const MAILPIT = process.env.LOCAL_MAIL_CATCHER_URL ?? "http://127.0.0.1:54324";
const SUBJECT = "Logg inn på TING";
const SENDER = { name: "TING", address: "ikke-svar@join-ting.no" };
// What sendMagicLink (app/actions.ts) passes: the allow-listed callback.
const REDIRECT = "http://localhost:3000/auth/callback?neste=%2Fhome";
const COPY = [
  ">Logg inn</h1>",
  "Bruk knappen nedenfor for å fortsette.",
  ">Logg inn →</a>",
  "Lenken er personlig og kan bare brukes én gang.",
  "Har du ikke bedt om dette? Se bort fra denne e-posten.",
];

let failures = 0;
let checks = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

const created: string[] = [];

type MailpitMessage = { ID: string; Subject: string; From: { Name: string; Address: string } };

async function latestTo(email: string): Promise<{ summary: MailpitMessage; html: string } | undefined> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const found = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).then((r) => r.json());
    const summary = (found.messages as MailpitMessage[] | undefined)?.[0];
    if (summary) {
      const full = await fetch(`${MAILPIT}/api/v1/message/${summary.ID}`).then((r) => r.json());
      return { summary, html: full.HTML as string };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
}

/** The words a reader sees: no head, comments, tags or attributes (so not the logo's alt). */
function visibleText(html: string): string {
  return html
    .replace(/<head>[\s\S]*?<\/head>/i, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Follows the email's link the way a browser would, without following the redirect. */
async function followLink(href: string) {
  const response = await fetch(href, { redirect: "manual" });
  const location = response.headers.get("location") ?? "";
  return { signedIn: location.includes("access_token="), refused: location.includes("error"), location };
}

async function checkDelivered(label: string, email: string) {
  const mail = await latestTo(email);
  expect(`${label}: e-posten kom fram`, Boolean(mail), true);
  if (!mail) return;
  expect(`${label}: avsender`, `${mail.summary.From.Name} <${mail.summary.From.Address}>`, `${SENDER.name} <${SENDER.address}>`);
  expect(`${label}: emne`, mail.summary.Subject, SUBJECT);
  for (const line of COPY) expect(`${label}: tekst «${line}»`, mail.html.includes(line), true);
  expect(`${label}: logoen er eneste TING i teksten`, /TING/.test(visibleText(mail.html)), false);
  expect(`${label}: ikke Supabase-standardteksten`, /Your sign-in link|Magic Link|Confirm your signup/i.test(mail.html), false);

  const logoSrc = mail.html.match(/<img\b[^>]*src="([^"]+)"/)?.[1];
  expect(`${label}: logoen peker på nettstedets TING-logo`, logoSrc, `http://localhost:3000${EMAIL_LOGO.path}`);
  const logoResponse = await fetch(logoSrc ?? "about:blank").catch(() => undefined);
  expect(`${label}: logoen lastes`, `${logoResponse?.status} ${logoResponse?.headers.get("content-type")}`, "200 image/png");

  const hrefs = [...mail.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replace(/&amp;/g, "&"));
  expect(`${label}: nøyaktig én lenke`, hrefs.length, 1);
  const link = new URL(hrefs[0]);
  expect(`${label}: lenken går til Supabase Auth`, link.origin + link.pathname, `${supabaseUrl()}/auth/v1/verify`);
  expect(`${label}: og tilbake til en godkjent adresse`, (link.searchParams.get("redirect_to") ?? "").startsWith("http://localhost:3000/auth/callback"), true);
  expect(`${label}: lenken står ikke andre steder i e-posten`, mail.html.split(link.searchParams.get("token") ?? "∅").length - 1, 1);

  const first = await followLink(link.href);
  expect(`${label}: lenken logger inn`, first.signedIn, true);
  const second = await followLink(link.href);
  expect(`${label}: lenken kan ikke brukes to ganger`, second.refused && !second.signedIn, true);
}

async function main() {
  // ── The template and its wiring ─────────────────────────────────────────
  const template = readFileSync("supabase/templates/sign-in.html", "utf8");
  const configToml = readFileSync("supabase/config.toml", "utf8");

  for (const kind of ["magic_link", "confirmation"]) {
    const section = configToml.split(`[auth.email.template.${kind}]`)[1]?.split("\n[")[0] ?? "";
    expect(`config: ${kind} bruker TING-malen`, section.includes('content_path = "./supabase/templates/sign-in.html"'), true);
    expect(`config: ${kind} har TING-emnet`, section.includes(`subject = "${SUBJECT}"`), true);
  }
  const localSmtp = configToml.split("[local_smtp]")[1]?.split("\n[")[0] ?? "";
  expect("config: lokal avsenderadresse", localSmtp.includes(`admin_email = "${SENDER.address}"`), true);
  expect("config: lokalt avsendernavn", localSmtp.includes(`sender_name = "${SENDER.name}"`), true);

  const variables = template.match(/\{\{[^}]*\}\}/g) ?? [];
  expect("mal: bare Supabase-variablene for logo og lenke", variables.join(" "), "{{ .SiteURL }} {{ .ConfirmationURL }}");
  expect("mal: lenkevariabelen står i knappens href", template.includes('href="{{ .ConfirmationURL }}"'), true);
  expect("mal: ingen hardkodede adresser", /https?:\/\//.test(template), false);
  expect("mal: ingen skript, stilark eller rammer", /<(script|link|iframe)\b/i.test(template), false);
  // The one image is the official TING logo, from the site itself, exactly
  // as the approval email shows it.
  const images = template.match(/<img\b[^>]*>/gi) ?? [];
  expect("mal: ett bilde", images.length, 1);
  expect("mal: TING-logoen fra nettstedet", images[0]?.includes(`src="{{ .SiteURL }}${EMAIL_LOGO.path}"`), true);
  expect(
    "mal: samme størrelse og alt-tekst som godkjennings-e-posten",
    images[0]?.includes(`width="${EMAIL_LOGO.width}" height="${EMAIL_LOGO.height}" alt="${EMAIL_LOGO.alt}"`),
    true,
  );
  expect(
    "mal: samme venstrejustering som godkjennings-e-posten",
    images[0]?.includes(`width:${EMAIL_LOGO.width}px;`) && images[0]?.includes(`margin:0 0 18px -${EMAIL_LOGO.offset}px;`),
    true,
  );
  const logoFile = readFileSync(`public${EMAIL_LOGO.path}`);
  expect("logo: PNG-filen finnes", logoFile.subarray(1, 4).toString(), "PNG");
  expect("logo: offisiell eksport, 976×264", `${logoFile.readUInt32BE(16)}×${logoFile.readUInt32BE(20)}`, "976×264");
  expect("logo: vist i riktig forhold", Math.round((EMAIL_LOGO.width * 264) / 976), EMAIL_LOGO.height);
  expect("mal: norsk", template.includes('<html lang="nb">'), true);
  expect("mal: logoen er eneste TING i teksten", /TING/.test(visibleText(template)), false);
  expect("mal: ingen fellesskapsmerkevare", /Tryggere|Under The Rug|UTR|FTR/.test(template), false);

  const palette = new Set(Object.entries(EMAIL_STYLE).filter(([key]) => key !== "font").map(([, value]) => value.toLowerCase()));
  const colours = new Set((template.match(/#[0-9a-f]{6}\b/gi) ?? []).map((value) => value.toLowerCase()));
  expect("mal: bare farger fra EMAIL_STYLE", [...colours].filter((value) => !palette.has(value)).join(","), "");
  for (const [key, value] of Object.entries(EMAIL_STYLE)) {
    if (key === "surface") continue; // white; present as both bgcolor and text
    expect(`mal: bruker EMAIL_STYLE.${key}`, template.includes(value), true);
  }

  // ── The account emails: reset, email change, and the two notices ────────
  // Same frame as the sign-in email, so the differences are exactly the
  // words and the link. Their delivery and their links are exercised for
  // real by `npm run check:account-security`.
  const frame = (html: string) =>
    html
      .replace(/<!--[\s\S]*?-->\n/, "")
      .replace(/<title>[^<]*<\/title>/, "")
      .replace(/<h1([^>]*)>[^<]*<\/h1>/, "<h1$1></h1>")
      .replace(/<p([^>]*)>[^<]*<\/p>\n/g, "")
      .replace(/ {10}<table role="presentation" cellpadding="0"[\s\S]*?<\/table>\n/, "");
  const accountMails = [
    {
      file: "recovery.html",
      section: "auth.email.template.recovery",
      subject: "Velg nytt passord på TING",
      variables: "{{ .SiteURL }} {{ .SiteURL }} {{ .TokenHash }}",
      href: "{{ .SiteURL }}/nytt-passord?token_hash={{ .TokenHash }}",
    },
    {
      file: "email-change.html",
      section: "auth.email.template.email_change",
      subject: "Bekreft ny e-postadresse på TING",
      variables: "{{ .SiteURL }} {{ .NewEmail }} {{ .SiteURL }} {{ .TokenHash }}",
      href: "{{ .SiteURL }}/bekreft-e-post?token_hash={{ .TokenHash }}",
    },
    {
      file: "password-changed.html",
      section: "auth.email.notification.password_changed",
      subject: "Passordet ditt på TING er endret",
      variables: "{{ .SiteURL }} {{ .SiteURL }}",
      href: "{{ .SiteURL }}/glemt-passord",
    },
    {
      file: "email-changed.html",
      section: "auth.email.notification.email_changed",
      subject: "E-postadressen for TING-kontoen din er endret",
      // No address at all: the previous inbox is not told where the account went.
      variables: "{{ .SiteURL }}",
      href: undefined,
    },
  ];
  for (const mail of accountMails) {
    const html = readFileSync(`supabase/templates/${mail.file}`, "utf8");
    const wiring = configToml.split(`[${mail.section}]`)[1]?.split("\n[")[0] ?? "";
    expect(`${mail.file}: koblet til i config`, wiring.includes(`content_path = "./supabase/templates/${mail.file}"`), true);
    expect(`${mail.file}: TING-emne`, wiring.includes(`subject = "${mail.subject}"`), true);
    if (mail.section.includes("notification")) expect(`${mail.file}: varselet er slått på`, wiring.includes("enabled = true"), true);
    expect(`${mail.file}: bare disse variablene`, (html.match(/\{\{[^}]*\}\}/g) ?? []).join(" "), mail.variables);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(`${mail.file}: lenken går til TINGs egen side`, hrefs.join(), mail.href ?? "");
    expect(`${mail.file}: ingen hardkodede adresser`, /https?:\/\//.test(html), false);
    expect(`${mail.file}: ingen skript, stilark eller rammer`, /<(script|link|iframe)\b/i.test(html), false);
    expect(`${mail.file}: logoen er eneste TING i teksten`, /TING/.test(visibleText(html)), false);
    expect(`${mail.file}: ingen fellesskapsmerkevare`, /Tryggere|Under The Rug|UTR|FTR/.test(html), false);
    expect(`${mail.file}: samme ramme som innloggings-e-posten`, frame(html), frame(template));
  }

  // ── The real email, for an existing account and a new address ───────────
  const existingEmail = `check.authmail.konto.${randomUUID().slice(0, 8)}@demo.join-ting.no`;
  const { data: existing, error } = await admin.auth.admin.createUser({ email: existingEmail, email_confirm: true });
  if (error) throw error;
  created.push(existing.user!.id);
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey(), { auth: { persistSession: false } });
  const sent = await anon.auth.signInWithOtp({ email: existingEmail, options: { shouldCreateUser: false, emailRedirectTo: REDIRECT } });
  expect("eksisterende konto: innloggingslenke bedt om", sent.error, null);
  await checkDelivered("eksisterende konto", existingEmail);

  const newEmail = `check.authmail.ny.${randomUUID().slice(0, 8)}@demo.join-ting.no`;
  const sentNew = await createClient<Database>(supabaseUrl(), supabaseAnonKey(), { auth: { persistSession: false } })
    .auth.signInWithOtp({ email: newEmail, options: { emailRedirectTo: REDIRECT } });
  expect("ny adresse: innloggingslenke bedt om", sentNew.error, null);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const newUser = users.users.find((user) => user.email === newEmail);
  if (newUser) created.push(newUser.id);
  await checkDelivered("ny adresse", newEmail);
  expect(
    "ny adresse: ingen medlemskap av å logge inn",
    ((await admin.from("memberships").select("id").eq("user_id", newUser?.id ?? "")).data ?? []).length,
    0,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    failures += 1;
  })
  .finally(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
    if (failures > 0) {
      console.error(`\n✗ ${failures} av ${checks} kontroller av innloggings-e-posten feilet.\n`);
      process.exit(1);
    }
    console.log(`✓ ${checks} kontroller av innloggings-e-posten passerte`);
  });
