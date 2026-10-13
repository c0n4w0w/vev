import type { EmailMessage, EmailProvider, EmailResult } from "@/lib/email/provider";

/**
 * Plain SMTP submission — the real way TING's own email leaves the server.
 *
 * Deliberately nothing but SMTP: a host, a port, how the connection is
 * encrypted, an optional login and a sender. Any mail service that offers
 * submission works, and moving to another is a change of five environment
 * variables. There is no provider name anywhere in here, and no API of any
 * one vendor.
 *
 * This is TING's mail only (today: the approval email). Supabase Auth sends
 * its own messages — sign-in links, password recovery, email change — through
 * the SMTP settings of the Supabase project, which are configured there and
 * never read by this code. The two can point at the same service; they share
 * no configuration.
 *
 * Imported by server code and by scripts under plain node, never by a Client
 * Component: the transport needs `node:net` and `node:tls`, and every setting
 * is a server-only environment variable with no `NEXT_PUBLIC_` name.
 */

export type SmtpSecurity = "starttls" | "tls" | "none";

export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  auth?: { user: string; pass: string };
  from: { name: string; address: string };
}

export type SmtpConfigResult =
  | { ok: true; config: SmtpConfig }
  /** Names of what is missing or wrong. Never a value: these get logged. */
  | { ok: false; problems: string[] };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** One mailbox, nothing a header or a second recipient could hide in. */
export function isSingleAddress(value: string): boolean {
  return value.length <= 254 && /^[^\s<>,;:"()[\]\\@]+@[^\s<>,;:"()[\]\\@]+\.[^\s<>,;:"()[\]\\@.]+$/.test(value);
}

/**
 * Reads the SMTP settings, and says by name what is wrong with them.
 *
 *   SMTP_HOST            the submission server
 *   SMTP_PORT            587 unless given
 *   SMTP_SECURITY        starttls | tls | none — see below
 *   SMTP_USER            optional, with SMTP_PASSWORD
 *   SMTP_PASSWORD
 *   EMAIL_FROM_ADDRESS   the sender, an address on a domain you may send for
 *   EMAIL_FROM_NAME      shown beside it; "TING" unless given
 *
 * `starttls` (the default, port 587) upgrades a plain connection and refuses
 * to continue if the server will not; `tls` (the default on port 465) is
 * encrypted from the first byte. Neither falls back to sending unencrypted.
 * `none` exists for a mail catcher on this machine and is refused for any
 * other host, so a password or an invitation link cannot cross a network in
 * the clear because of a typo.
 */
export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfigResult {
  const problems: string[] = [];
  const read = (name: string) => env[name]?.trim() || undefined;

  const host = read("SMTP_HOST");
  if (!host) problems.push("SMTP_HOST mangler");

  const portText = read("SMTP_PORT");
  const port = portText === undefined ? 587 : Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("SMTP_PORT er ikke et portnummer");

  const securityText = read("SMTP_SECURITY")?.toLowerCase();
  let security: SmtpSecurity = port === 465 ? "tls" : "starttls";
  if (securityText === "starttls" || securityText === "tls" || securityText === "none") {
    security = securityText;
  } else if (securityText !== undefined) {
    problems.push("SMTP_SECURITY må være starttls, tls eller none");
  }
  if (security === "none" && host && !LOOPBACK.has(host.toLowerCase())) {
    problems.push("SMTP_SECURITY=none er bare tillatt mot denne maskinen (localhost)");
  }

  const user = read("SMTP_USER");
  // A password may legitimately begin or end with a space; only emptiness counts.
  const pass = env.SMTP_PASSWORD || undefined;
  if (user && !pass) problems.push("SMTP_PASSWORD mangler (SMTP_USER er satt)");
  if (pass && !user) problems.push("SMTP_USER mangler (SMTP_PASSWORD er satt)");

  const address = read("EMAIL_FROM_ADDRESS");
  if (!address) problems.push("EMAIL_FROM_ADDRESS mangler");
  else if (!isSingleAddress(address)) problems.push("EMAIL_FROM_ADDRESS er ikke én e-postadresse");

  const name = (read("EMAIL_FROM_NAME") ?? "TING").replace(/[\r\n]+/g, " ");
  if (name.length > 80) problems.push("EMAIL_FROM_NAME er for langt");

  if (problems.length > 0 || !host || !address) return { ok: false, problems };
  return {
    ok: true,
    config: { host, port, security, auth: user && pass ? { user, pass } : undefined, from: { name, address } },
  };
}

/** What nodemailer attaches to the errors it throws. */
type SmtpError = { code?: string; responseCode?: number; command?: string };

type Failure = Extract<EmailResult, { ok: false }>;

/**
 * Sorts a failed send into what the administrator can do about it.
 *
 * `handedOver` is whether the envelope and message had been started on this
 * connection. It is the caller's knowledge, not the error's: nodemailer
 * reports a dropped connection the same way whether it dropped at the
 * greeting or after the last byte of the message.
 *
 * The server's own words are not passed on: an SMTP reply routinely quotes
 * the recipient's address and names internal hosts. The log line carries the
 * numbers that identify the failure, and the sentence shown comes from the
 * app's dictionaries (see `err.email.*`).
 */
export function classifySmtpFailure(
  error: unknown,
  handedOver: boolean,
): { reason: SmtpFailureReason; retry: boolean } {
  const { code, responseCode, command } = (error ?? {}) as SmtpError;

  // The login, the encryption or the settings themselves. Trying again with
  // the same settings ends the same way.
  if (
    code === "EAUTH" || code === "ENOAUTH" || code === "ECONFIG" || code === "ETLS" || code === "EREQUIRETLS" ||
    command === "STARTTLS" || /^AUTH\b/.test(command ?? "")
  ) {
    return { reason: "configuration", retry: false };
  }

  // The server answered. A 4xx is "not now" and a 5xx is "no" — either way it
  // did not take the message, so a 4xx is safe to try again.
  if (typeof responseCode === "number" && responseCode >= 400 && responseCode < 500) {
    return { reason: "temporary", retry: true };
  }
  if (typeof responseCode === "number" && responseCode >= 500) {
    // Refusing the sender is about this deployment, not about the recipient.
    return command === "MAIL FROM" ? { reason: "configuration", retry: false } : { reason: "rejected", retry: false };
  }
  if (code === "EENVELOPE") return { reason: "rejected", retry: false };

  // No answer: the connection failed. Before anything was handed over, that
  // is safe to try again. After, nobody knows whether the server kept it.
  return handedOver ? { reason: "uncertain", retry: false } : { reason: "temporary", retry: true };
}

type SmtpFailureReason = Exclude<Failure["reason"], "local">;

/** For logs and scripts. What an administrator reads is `err.email.<reason>`. */
const FAILURE_TEXT: Record<SmtpFailureReason, string> = {
  temporary: "E-posttjenesten svarte ikke, eller ba oss prøve igjen senere.",
  rejected: "E-posttjenesten avviste meldingen eller mottakeradressen.",
  configuration: "Utsending av e-post er ikke satt opp riktig på denne installasjonen.",
  uncertain: "Forbindelsen ble brutt mens e-posten ble sendt, så det er uvisst om den kom fram.",
};

export function emailFailure(reason: SmtpFailureReason): Failure {
  return { ok: false, reason, error: FAILURE_TEXT[reason] };
}

/** `@example.org` — enough to find a failure in the log, not who it was to. */
function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@"));
}

export interface SmtpProviderOptions {
  /** Pause before the one automatic retry. Shortened by the checks. */
  retryDelayMs?: number;
  /** How long to wait for a connection, a greeting, and any single reply. */
  timeoutMs?: number;
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";

  constructor(
    private readonly config: SmtpConfig,
    private readonly options: SmtpProviderOptions = {},
  ) {}

  /** The message as the bytes that go on the wire, built once per send. */
  private async compose(message: EmailMessage): Promise<{ raw: Buffer; messageId: string }> {
    const { createTransport } = await import("nodemailer");
    const composer = createTransport({
      streamTransport: true,
      buffer: true,
      newline: "windows",
      // A message is text and HTML built here. Nothing in it may make the
      // server read a file or fetch a URL on its way out.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const info = await composer.sendMail({
      from: this.config.from,
      // An address object, not a string: a string is parsed as a list.
      to: { name: "", address: message.to },
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: {
        // Sent by a program on someone's action; do not auto-reply to it.
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "All",
      },
    });
    return { raw: info.message as Buffer, messageId: info.messageId };
  }

  /**
   * One connection: connect, encrypt, log in and — when `raw` is given — hand
   * the message over. Rejects with nodemailer's error, marked with whether
   * the handing over had begun.
   */
  private async converse(raw?: { message: Buffer; to: string }): Promise<void> {
    const { default: SMTPConnection } = await import("nodemailer/lib/smtp-connection");
    const { host, port, security, auth, from } = this.config;
    const timeout = this.options.timeoutMs ?? 10_000;
    const connection = new SMTPConnection({
      host,
      port,
      secure: security === "tls",
      // Never continue in the clear when asked for encryption, and never
      // negotiate it with a local catcher that was configured without.
      requireTLS: security === "starttls",
      ignoreTLS: security === "none",
      tls: { minVersion: "TLSv1.2" },
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      dnsTimeout: timeout,
      socketTimeout: timeout * 2,
    });

    let handedOver = false;
    // Errors with no command waiting for them arrive as an event.
    const broken = new Promise<never>((_, reject) => connection.on("error", reject));
    broken.catch(() => undefined);
    const step = <T>(run: (done: (error?: Error | null, result?: T) => void) => void) =>
      Promise.race([
        new Promise<T>((resolve, reject) => run((error, result) => (error ? reject(error) : resolve(result as T)))),
        broken,
      ]);

    try {
      await step<void>((done) => connection.connect(done));
      if (auth) await step((done) => connection.login({ user: auth.user, pass: auth.pass }, done));
      if (!raw) return;

      handedOver = true;
      const info = await step<{ accepted: string[]; rejected: string[] }>((done) =>
        connection.send({ from: from.address, to: [raw.to] }, raw.message, done),
      );
      if (info.rejected.length > 0 || info.accepted.length === 0) {
        throw Object.assign(new Error("recipient rejected"), { code: "EENVELOPE" });
      }
      connection.quit();
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error("smtp"), { handedOver });
    } finally {
      connection.close();
    }
  }

  private report(what: string, error: unknown): { reason: SmtpFailureReason; retry: boolean } {
    const verdict = classifySmtpFailure(error, (error as { handedOver?: boolean }).handedOver === true);
    const { code, responseCode, command } = (error ?? {}) as SmtpError;
    // Codes only. The error's message can quote the recipient, and its other
    // fields can carry the login.
    console.error(
      `[e-post] ${what}: ${verdict.reason}` +
        ` — kode ${code ?? "ukjent"}, svar ${responseCode ?? "ingen"}, steg ${command ?? "ukjent"}.`,
    );
    return verdict;
  }

  /**
   * Hands one message to the SMTP server.
   *
   * `ok` means the server took responsibility for it — the 250 after the
   * message body — and nothing more. Whether it reaches the inbox is decided
   * later, by servers this code never talks to; a bounce comes back to the
   * sender address, not here. Nothing is reported as sent on an attempt alone.
   *
   * One automatic retry, and only when the server cannot have the message:
   * it answered "not now", or the connection failed before the message was
   * started. The retry carries the same Message-ID. A connection lost after
   * that is reported as uncertain and left to the administrator, who resends
   * from the requests page — which issues a fresh invitation and revokes
   * this one.
   */
  async send(message: EmailMessage): Promise<EmailResult> {
    if (!isSingleAddress(message.to)) {
      console.error("[e-post] Avvist før sending: mottakeren er ikke én e-postadresse.");
      return emailFailure("rejected");
    }

    const to = domainOf(message.to);
    const { raw, messageId } = await this.compose(message);
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.converse({ message: raw, to: message.to });
        console.info(`[e-post] Overlevert til SMTP-tjeneren (til ${to}, id ${messageId}).`);
        return { ok: true, id: messageId };
      } catch (error) {
        const { reason, retry } = this.report(`SMTP-sending feilet (til ${to}, forsøk ${attempt})`, error);
        if (!retry || attempt >= 2) return emailFailure(reason);
        await new Promise((resolve) => setTimeout(resolve, this.options.retryDelayMs ?? 1500));
      }
    }
  }

  /** Connects and logs in without sending anything. For `npm run email:check`. */
  async verify(): Promise<EmailResult> {
    try {
      await this.converse();
      return { ok: true, id: "verify" };
    } catch (error) {
      return emailFailure(this.report("SMTP-tilkobling feilet", error).reason);
    }
  }
}
