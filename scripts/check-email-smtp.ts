/**
 * Checks TING's SMTP delivery against a disposable SMTP server in this
 * process — no network, no real mailbox, no Supabase.
 *
 * The server below speaks just enough SMTP to accept a message, and can be
 * told to misbehave at each step: refuse the login, defer or reject the
 * recipient, reject the message, or drop the connection once the message is
 * on the wire. What is checked is what TING does in each case — above all
 * that it sends one email, to one address, and says "sent" only when the
 * server took it.
 *
 * Run with `npm run check:email-smtp`.
 */
import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { buildInvitationEmail, sendInvitationEmail } from "@/lib/email/invitation";
import { getEmailProvider } from "@/lib/email/provider";
import { classifySmtpFailure, SmtpEmailProvider, smtpConfigFromEnv, type SmtpConfig } from "@/lib/email/smtp";

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

// ── A disposable SMTP server ──────────────────────────────────────────────

type Step = "greeting" | "auth" | "mailFrom" | "rcptTo" | "data" | "accepted";

interface Behaviour {
  /** Reply to give at a step instead of the usual one. */
  reply?: Partial<Record<Step, string>>;
  /** Close the connection without a word once the message body has arrived. */
  dropAfterMessage?: boolean;
  /** Accept only this login, and require one. */
  login?: { user: string; pass: string };
}

interface Session {
  commands: string[];
  from?: string;
  to: string[];
  message?: string;
  loggedIn: boolean;
}

class TestSmtpServer {
  readonly sessions: Session[] = [];
  private server: Server;
  /** Behaviour per connection, in order; the last one repeats. */
  private script: Behaviour[] = [{}];

  constructor() {
    this.server = createServer((socket) => this.serve(socket));
  }

  listen(): Promise<number> {
    return new Promise((resolve) => this.server.listen(0, "127.0.0.1", () => resolve((this.server.address() as AddressInfo).port)));
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  /** Forgets what was received and sets how the next connections behave. */
  expectConnections(...script: Behaviour[]) {
    this.sessions.length = 0;
    this.script = script.length > 0 ? script : [{}];
  }

  get delivered(): Session[] {
    return this.sessions.filter((session) => session.message !== undefined && session.commands.includes("<accepted>"));
  }

  private serve(socket: Socket) {
    const behaviour = this.script[Math.min(this.sessions.length, this.script.length - 1)];
    const session: Session = { commands: [], to: [], loggedIn: false };
    this.sessions.push(session);
    const say = (line: string) => socket.write(`${line}\r\n`);

    let buffer = "";
    let receiving = false;
    socket.on("error", () => undefined);
    say(behaviour.reply?.greeting ?? "220 test.invalid ESMTP");

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (receiving) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          session.message = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          receiving = false;
          if (behaviour.dropAfterMessage) {
            socket.destroy();
            return;
          }
          const verdict = behaviour.reply?.accepted ?? "250 2.0.0 queued";
          if (verdict.startsWith("2")) session.commands.push("<accepted>");
          else session.message = undefined;
          say(verdict);
          continue;
        }

        const newline = buffer.indexOf("\r\n");
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        const verb = line.split(" ")[0].toUpperCase();
        // Never keep what follows AUTH: that is the login.
        session.commands.push(verb === "AUTH" ? "AUTH" : line);

        if (verb === "EHLO") {
          say("250-test.invalid");
          if (behaviour.login) say("250-AUTH PLAIN");
          say("250 SIZE 1000000");
        } else if (verb === "AUTH") {
          const [, user, pass] = Buffer.from(line.split(" ")[2] ?? "", "base64").toString("utf8").split("\0");
          session.loggedIn = behaviour.login?.user === user && behaviour.login?.pass === pass;
          say(behaviour.reply?.auth ?? (session.loggedIn ? "235 2.7.0 ok" : "535 5.7.8 authentication failed"));
        } else if (verb === "MAIL") {
          if (behaviour.login && !session.loggedIn) say("530 5.7.0 authentication required");
          else {
            session.from = /<([^>]*)>/.exec(line)?.[1];
            say(behaviour.reply?.mailFrom ?? "250 2.1.0 ok");
          }
        } else if (verb === "RCPT") {
          const reply = behaviour.reply?.rcptTo ?? "250 2.1.5 ok";
          if (reply.startsWith("2")) session.to.push(/<([^>]*)>/.exec(line)?.[1] ?? "");
          say(reply);
        } else if (verb === "DATA") {
          const reply = behaviour.reply?.data ?? "354 go ahead";
          receiving = reply.startsWith("3");
          say(reply);
        } else if (verb === "QUIT") {
          say("221 2.0.0 bye");
          socket.end();
        } else if (verb === "RSET" || verb === "NOOP") {
          say("250 ok");
        } else {
          // Including STARTTLS: this server offers no encryption.
          say("502 5.5.1 command not implemented");
        }
      }
    });
  }
}

// ── Reading what arrived ──────────────────────────────────────────────────

/** Undoes quoted-printable, which is how a mail with æøå or long lines travels. */
function decodeQuotedPrintable(text: string): string {
  const bytes = text
    .replace(/=\r\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return Buffer.from(bytes, "latin1").toString("utf8");
}

function header(message: string, name: string): string | undefined {
  const head = message.slice(0, message.indexOf("\r\n\r\n")).replace(/\r\n[ \t]+/g, " ");
  return new RegExp(`^${name}: (.*)$`, "mi").exec(head)?.[1];
}

function headerNames(message: string): string[] {
  const head = message.slice(0, message.indexOf("\r\n\r\n")).replace(/\r\n[ \t]+/g, " ");
  return head.split("\r\n").map((line) => line.slice(0, line.indexOf(":")).toLowerCase());
}

function part(message: string, type: string): string {
  const boundary = /boundary="?([^";\r\n]+)"?/.exec(message)?.[1] ?? "";
  const found = message.split(`--${boundary}`).find((section) => new RegExp(`^\\s*Content-Type: ${type}`, "mi").test(section)) ?? "";
  return decodeQuotedPrintable(found.slice(found.indexOf("\r\n\r\n") + 4));
}

// ── The checks ────────────────────────────────────────────────────────────

const SENDER = "ikke-svar@ting.invalid";
const RECIPIENT = "ny.person@mottaker.invalid";
const PASSWORD = "hemmelig-smtp-passord-0123456789";
const TOKEN = "f3a1c5b7d9e2f4a6c8b0d1e3f5a7c9b1d3e5f7a9c1b3d5e7f9a1c3b5d7e9f1a3";
const SIGN_IN = "b7e2a9c4d1f6083a5c7e9b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a";
const ORIGIN = "https://join-ting.invalid";
const ACCEPT_URL = `${ORIGIN}/invitasjon/${TOKEN}?innlogging=${SIGN_IN}`;

function invitation(overrides: Partial<Parameters<typeof buildInvitationEmail>[0]> = {}) {
  return {
    to: RECIPIENT,
    communityName: "Tryggere Ruspolitikk",
    acceptUrl: ACCEPT_URL,
    kind: "new" as const,
    signInExpiresAt: "2026-11-02T12:00:00.000Z",
    invitationExpiresAt: "2026-11-15T12:00:00.000Z",
    accent: "#1f4a3d",
    locale: "nb" as const,
    origin: ORIGIN,
    ...overrides,
  };
}

function checkConfiguration() {
  const full = { SMTP_HOST: "smtp.example.org", EMAIL_FROM_ADDRESS: SENDER } as unknown as NodeJS.ProcessEnv;

  const defaults = smtpConfigFromEnv(full);
  expect("oppsett: vert og avsender er nok", defaults.ok, true);
  if (defaults.ok) {
    expect("oppsett: port 587 som standard", defaults.config.port, 587);
    expect("oppsett: STARTTLS som standard", defaults.config.security, "starttls");
    expect("oppsett: avsendernavn TING som standard", defaults.config.from.name, "TING");
    expect("oppsett: ingen innlogging uten brukernavn", defaults.config.auth, undefined);
  }
  const implicit = smtpConfigFromEnv({ ...full, SMTP_PORT: "465" });
  expect("oppsett: port 465 betyr TLS fra første byte", implicit.ok && implicit.config.security, "tls");

  const empty = smtpConfigFromEnv({} as NodeJS.ProcessEnv);
  expect("oppsett: tomt oppsett avvises", empty.ok, false);
  expect("oppsett: … og sier hva som mangler", !empty.ok && empty.problems.join("|"), "SMTP_HOST mangler|EMAIL_FROM_ADDRESS mangler");

  const clear = smtpConfigFromEnv({ ...full, SMTP_SECURITY: "none" });
  expect("oppsett: ukryptert til en annen maskin avvises", clear.ok, false);
  expect("oppsett: ukryptert til denne maskinen godtas", smtpConfigFromEnv({ ...full, SMTP_HOST: "127.0.0.1", SMTP_SECURITY: "none" }).ok, true);

  const halfLogin = smtpConfigFromEnv({ ...full, SMTP_USER: "ting" });
  expect("oppsett: brukernavn uten passord avvises", halfLogin.ok, false);
  const wrong = smtpConfigFromEnv({ ...full, SMTP_USER: "ting", SMTP_PORT: "smtp", SMTP_SECURITY: "ssl", EMAIL_FROM_ADDRESS: `${SENDER}, ${RECIPIENT}`, SMTP_PASSWORD: "" });
  expect("oppsett: fire feil gir fire navngitte problemer", !wrong.ok && wrong.problems.length, 4);
  const withPassword = smtpConfigFromEnv({ ...full, SMTP_PASSWORD: PASSWORD });
  expect("oppsett: et problem nevner aldri passordet", !withPassword.ok && withPassword.problems.join(" ").includes(PASSWORD), false);

  // Which provider a process gets.
  const provider = (env: Record<string, string>) => getEmailProvider(env as unknown as NodeJS.ProcessEnv).name;
  expect("valg: utvikling uten valg skriver til fil", provider({ NODE_ENV: "development" }), "fil (utvikling)");
  expect("valg: produksjon uten valg sender ingenting", provider({ NODE_ENV: "production" }), "ikke konfigurert");
  expect("valg: produksjon godtar ikke fil", provider({ NODE_ENV: "production", EMAIL_PROVIDER: "fil" }), "ikke konfigurert");
  expect("valg: smtp uten oppsett sender ingenting", provider({ NODE_ENV: "production", EMAIL_PROVIDER: "smtp" }), "ikke konfigurert");
  expect("valg: smtp med oppsett er smtp", provider({ NODE_ENV: "production", EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp.example.org", EMAIL_FROM_ADDRESS: SENDER }), "smtp");
  expect("valg: en ukjent leverandør sender ingenting", provider({ NODE_ENV: "development", EMAIL_PROVIDER: "postkontoret" }), "ikke konfigurert");

  // How failures are sorted. The second argument is whether the message had
  // been started on the connection.
  const sorted = (error: object, handedOver: boolean) => {
    const { reason, retry } = classifySmtpFailure(error, handedOver);
    return `${reason}:${retry}`;
  };
  expect("feil: 451 ved mottaker er midlertidig", sorted({ responseCode: 451, command: "RCPT TO" }, true), "temporary:true");
  expect("feil: 550 ved mottaker er avvist", sorted({ responseCode: 550, command: "RCPT TO", code: "EENVELOPE" }, true), "rejected:false");
  expect("feil: 554 på meldingen er avvist", sorted({ responseCode: 554, command: "DATA" }, true), "rejected:false");
  expect("feil: 550 på avsenderen er oppsett", sorted({ responseCode: 550, command: "MAIL FROM" }, true), "configuration:false");
  expect("feil: avvist innlogging er oppsett", sorted({ responseCode: 535, command: "AUTH PLAIN", code: "EAUTH" }, false), "configuration:false");
  expect("feil: innlogging utsatt er fortsatt oppsett", sorted({ responseCode: 454, command: "AUTH PLAIN", code: "EAUTH" }, false), "configuration:false");
  expect("feil: mislykket kryptering er oppsett", sorted({ code: "ETLS", command: "CONN" }, false), "configuration:false");
  expect("feil: ingen forbindelse er midlertidig", sorted({ code: "ESOCKET", command: "CONN" }, false), "temporary:true");
  expect("feil: tidsavbrudd før meldingen er midlertidig", sorted({ code: "ETIMEDOUT", command: "CONN" }, false), "temporary:true");
  expect("feil: brudd etter at meldingen er påbegynt er uvisst", sorted({ code: "ECONNECTION", command: "CONN" }, true), "uncertain:false");
  expect("feil: tidsavbrudd etter at meldingen er påbegynt er uvisst", sorted({ code: "ETIMEDOUT", command: "CONN" }, true), "uncertain:false");
}

async function main() {
  checkConfiguration();

  const server = new TestSmtpServer();
  const port = await server.listen();
  const config: SmtpConfig = { host: "127.0.0.1", port, security: "none", from: { name: "TING", address: SENDER } };
  const provider = (overrides: Partial<SmtpConfig> = {}) =>
    new SmtpEmailProvider({ ...config, ...overrides }, { retryDelayMs: 10, timeoutMs: 2000 });

  // Everything the provider writes to the log during the checks.
  const logged: string[] = [];
  const original = { info: console.info, error: console.error };
  console.info = (...args: unknown[]) => void logged.push(args.join(" "));
  const report = console.error;
  console.error = (...args: unknown[]) => {
    const line = args.join(" ");
    if (line.startsWith("[e-post]")) logged.push(line);
    else report(...args);
  };

  // 1. The approval email, as the server receives it.
  for (const locale of ["nb", "en"] as const) {
    server.expectConnections({});
    const mail = buildInvitationEmail(invitation({ locale }));
    const result = await provider().send(mail);
    const [received] = server.delivered;
    expect(`${locale}: sendingen lyktes`, result.ok, true);
    expect(`${locale}: én forbindelse, én melding`, `${server.sessions.length}/${server.delivered.length}`, "1/1");
    expect(`${locale}: konvoluttens avsender`, received?.from, SENDER);
    expect(`${locale}: konvoluttens mottaker er bare den ene`, received?.to.join(","), RECIPIENT);
    const raw = received?.message ?? "";
    expect(`${locale}: From viser navn og adresse`, header(raw, "From"), `TING <${SENDER}>`);
    expect(`${locale}: To er mottakeren`, header(raw, "To"), RECIPIENT);
    expect(`${locale}: ingen Cc eller Bcc`, headerNames(raw).filter((name) => name === "cc" || name === "bcc").length, 0);
    expect(`${locale}: merket som automatisk`, header(raw, "Auto-Submitted"), "auto-generated");
    expect(`${locale}: Message-ID på avsenderens domene`, /@ting\.invalid>$/.test(header(raw, "Message-ID") ?? ""), true);
    expect(`${locale}: tekst og HTML som alternativer`, /^multipart\/alternative/.test(header(raw, "Content-Type") ?? ""), true);
    const text = part(raw, "text/plain");
    const html = part(raw, "text/html");
    expect(`${locale}: teksten er den som ble bygget`, text.trim(), mail.text.replace(/\n/g, "\r\n").trim());
    expect(`${locale}: HTML-en er den som ble bygget`, html.trim(), mail.html.replace(/\n/g, "\r\n").trim());
    expect(`${locale}: teksten har lenken, hel`, text.includes(ACCEPT_URL), true);
    expect(`${locale}: HTML-en har lenken én gang`, html.split(`href="${ACCEPT_URL.replace(/&/g, "&amp;")}"`).length - 1, 1);
    expect(`${locale}: HTML-en har TING-logoen fra nettstedet`, html.includes(`src="${ORIGIN}/brand/ting-horizontal-spruce-976.png"`), true);
    expect(`${locale}: fellesskapet er navngitt`, text.includes("Tryggere Ruspolitikk"), true);
    expect(`${locale}: språket`, /<html lang="(\w+)"/.exec(html)?.[1], locale);
  }

  // 2. A server that wants a login gets it, and a wrong one stops there.
  server.expectConnections({ login: { user: "ting", pass: PASSWORD } });
  const authed = await provider({ auth: { user: "ting", pass: PASSWORD } }).send(buildInvitationEmail(invitation()));
  expect("innlogging: riktig passord sender", `${authed.ok}/${server.delivered.length}`, "true/1");

  server.expectConnections({ login: { user: "ting", pass: PASSWORD } });
  const denied = await provider({ auth: { user: "ting", pass: "feil-passord" } }).send(buildInvitationEmail(invitation()));
  expect("innlogging: feil passord er en oppsettsfeil", !denied.ok && denied.reason, "configuration");
  expect("innlogging: … prøves ikke på nytt", server.sessions.length, 1);
  expect("innlogging: … og ingenting sendes", server.sessions[0].commands.some((line) => line.startsWith("MAIL")), false);

  // 3. Encryption that was asked for is not quietly skipped.
  server.expectConnections({ login: { user: "ting", pass: PASSWORD } });
  const noTls = await provider({ security: "starttls", auth: { user: "ting", pass: PASSWORD } }).send(buildInvitationEmail(invitation()));
  expect("kryptering: uten STARTTLS sendes ingenting", !noTls.ok && noTls.reason, "configuration");
  expect(
    "kryptering: verken innlogging eller melding gikk ukryptert",
    server.sessions.flatMap((session) => session.commands).some((line) => line === "AUTH" || line.startsWith("MAIL")),
    false,
  );

  // 4. A temporary refusal: one retry, and still exactly one email.
  server.expectConnections({ reply: { rcptTo: "451 4.7.1 greylisted, try again" } }, {});
  const retried = await provider().send(buildInvitationEmail(invitation()));
  expect("midlertidig: lykkes på andre forsøk", retried.ok, true);
  expect("midlertidig: to forbindelser, én melding", `${server.sessions.length}/${server.delivered.length}`, "2/1");

  server.expectConnections({ reply: { rcptTo: "451 4.7.1 try again later" } });
  const deferred = await provider().send(buildInvitationEmail(invitation()));
  expect("midlertidig: gir seg etter to forsøk", !deferred.ok && deferred.reason, "temporary");
  expect("midlertidig: … uten å ha sendt noe", `${server.sessions.length}/${server.delivered.length}`, "2/0");

  server.expectConnections({ reply: { greeting: "421 4.3.2 service not available" } });
  const unavailable = await provider().send(buildInvitationEmail(invitation()));
  expect("midlertidig: tjeneren tar ikke imot nå", !unavailable.ok && unavailable.reason, "temporary");

  const nothingListening = await new SmtpEmailProvider({ ...config, port: 9 }, { retryDelayMs: 10, timeoutMs: 1000 }).send(
    buildInvitationEmail(invitation()),
  );
  expect("midlertidig: ingen tjener å nå", !nothingListening.ok && nothingListening.reason, "temporary");

  // 5. A permanent refusal is not retried and not reported as sent.
  server.expectConnections({ reply: { rcptTo: "550 5.1.1 <ny.person@mottaker.invalid> user unknown" } });
  const unknown = await provider().send(buildInvitationEmail(invitation()));
  expect("avvist: ukjent mottaker", !unknown.ok && unknown.reason, "rejected");
  expect("avvist: … ett forsøk, ingen melding", `${server.sessions.length}/${server.delivered.length}`, "1/0");

  server.expectConnections({ reply: { accepted: "554 5.7.1 message refused" } });
  const refused = await provider().send(buildInvitationEmail(invitation()));
  expect("avvist: meldingen nektes etter innholdet", !refused.ok && refused.reason, "rejected");
  expect("avvist: … ett forsøk, ingen melding", `${server.sessions.length}/${server.delivered.length}`, "1/0");

  server.expectConnections({ reply: { mailFrom: "550 5.7.1 sender not permitted" } });
  const badSender = await provider().send(buildInvitationEmail(invitation()));
  expect("avvist: avsenderen er ikke tillatt – oppsett", !badSender.ok && badSender.reason, "configuration");

  // 6. A connection lost once the message is on the wire is never called
  //    sent, and never sent again on its own.
  server.expectConnections({ dropAfterMessage: true }, {});
  const lost = await provider().send(buildInvitationEmail(invitation()));
  expect("uvisst: rapporteres ikke som sendt", lost.ok, false);
  expect("uvisst: … men som uvisst", !lost.ok && lost.reason, "uncertain");
  expect("uvisst: ikke noe nytt forsøk på egen hånd", server.sessions.length, 1);

  // 7. One recipient, whatever the address field holds.
  server.expectConnections({});
  const two = await provider().send({ ...buildInvitationEmail(invitation()), to: `${RECIPIENT}, annen@mottaker.invalid` });
  expect("mottaker: en liste avvises", !two.ok && two.reason, "rejected");
  expect("mottaker: … uten å kontakte tjeneren", server.sessions.length, 0);
  const injected = await provider().send({ ...buildInvitationEmail(invitation()), to: `${RECIPIENT}\r\nBcc: annen@mottaker.invalid` });
  expect("mottaker: linjeskift i adressen avvises", !injected.ok && injected.reason, "rejected");

  server.expectConnections({});
  await provider().send({ ...buildInvitationEmail(invitation()), subject: "Velkommen\r\nBcc: annen@mottaker.invalid" });
  const smuggled = server.delivered[0];
  expect("emne: et linjeskift blir ikke en ny header", headerNames(smuggled?.message ?? "").includes("bcc"), false);
  expect("emne: … og ingen ny mottaker", smuggled?.to.join(","), RECIPIENT);

  // 8. The whole path the approval takes, configured from the environment.
  Object.assign(process.env, {
    EMAIL_PROVIDER: "smtp",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(port),
    SMTP_SECURITY: "none",
    SMTP_USER: "ting",
    SMTP_PASSWORD: PASSWORD,
    EMAIL_FROM_ADDRESS: SENDER,
    EMAIL_FROM_NAME: "TING",
  });
  server.expectConnections({ login: { user: "ting", pass: PASSWORD } });
  const sent = await sendInvitationEmail(invitation());
  expect("godkjenning: e-posten går gjennom SMTP", `${sent.ok}/${server.delivered.length}`, "true/1");
  expect("godkjenning: til den ene adressen", server.delivered[0]?.to.join(","), RECIPIENT);

  server.expectConnections({});
  const elsewhere = await sendInvitationEmail(invitation({ acceptUrl: `https://ondsinnet.invalid/invitasjon/${TOKEN}` }));
  expect("godkjenning: en lenke til et annet nettsted sendes ikke", !elsewhere.ok && elsewhere.reason, "configuration");
  expect("godkjenning: … og tjeneren kontaktes ikke", server.sessions.length, 0);
  const scheme = await sendInvitationEmail(invitation({ acceptUrl: `javascript:alert(1)//${ORIGIN}/invitasjon/${TOKEN}` }));
  expect("godkjenning: bare http(s)-lenker", !scheme.ok && scheme.reason, "configuration");

  // A production process that was never told how to send says so and writes
  // nothing — the file provider is not a fallback.
  const unset = await getEmailProvider({ NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv).send(buildInvitationEmail(invitation()));
  expect("produksjon uten oppsett: ingenting sendes", !unset.ok && unset.reason, "configuration");

  // 9. The log names no person, no link and no secret.
  console.info = original.info;
  console.error = original.error;
  const log = logged.join("\n");
  expect("logg: noe ble logget", logged.length > 10, true);
  expect("logg: ikke invitasjonstokenet", log.includes(TOKEN), false);
  expect("logg: ikke innloggingstokenet", log.includes(SIGN_IN), false);
  expect("logg: ikke en lenke", /https?:\/\//.test(log), false);
  expect("logg: ikke SMTP-passordet", log.includes(PASSWORD) || log.includes("feil-passord"), false);
  expect("logg: ikke mottakerens adresse", log.includes(RECIPIENT) || log.includes("ny.person"), false);
  expect("logg: men domenet, så en feil kan finnes igjen", log.includes("@mottaker.invalid"), true);

  await server.close();

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} e-postkontroller feilet.\n`);
    process.exit(1);
  }
  console.log(`✓ ${checks} e-postkontroller passerte`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
