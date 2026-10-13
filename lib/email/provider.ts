import { isDemoDeployment } from "@/lib/environment";
import { emailFailure, SmtpEmailProvider, smtpConfigFromEnv } from "@/lib/email/smtp";

/**
 * The seam between TING and however mail actually gets sent.
 *
 * Nothing in the application knows whether a message went to a real provider
 * or to a file on disk. That matters for two reasons: local development must
 * never be able to mail a real person by accident, and the provider is the
 * kind of dependency that gets swapped once and then never thought about.
 *
 * Which implementation is used is decided by environment alone. There are no
 * credentials in this repository, and none belong here.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text is the message; HTML is a nicety some clients render instead. */
  text: string;
  html: string;
}

/**
 * `ok` means the message was handed over — written to disk, or accepted by
 * the SMTP server. It never means it reached an inbox; nothing here can know
 * that.
 *
 * A failure says which kind, so the caller can tell an administrator what to
 * do next in their own language (`err.email.<reason>`):
 *
 *   temporary       not now; sending again is safe
 *   rejected        the server refused the message or the address
 *   configuration   this deployment's mail settings are missing or wrong
 *   uncertain       the connection died mid-message; it may have arrived
 *   local           the development provider could not write or deliver
 *
 * `error` is a plain sentence for logs and scripts. It never contains a
 * credential, a link or the server's own reply.
 */
export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: "temporary" | "rejected" | "configuration" | "uncertain" | "local"; error: string };

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailResult>;
}

/**
 * Development provider: writes each message to `.vev-dev-mail/` and logs where
 * it went. Nothing leaves the machine.
 *
 * The files are the inspection surface — open the `.html` in a browser to see
 * exactly what a recipient would get, including the invitation link.
 *
 * With `LOCAL_MAIL_CATCHER_URL` set, each message is also handed to the local
 * Supabase stack's mail catcher (Mailpit, `supabase start`), so an invitation
 * lands in the same inbox as the sign-in link that follows it. Loopback
 * addresses only: anything else is refused, so this cannot be pointed at a
 * real mail service by mistake.
 */
class FileEmailProvider implements EmailProvider {
  readonly name = "fil (utvikling)";

  async send(message: EmailMessage): Promise<EmailResult> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const dir = join(process.cwd(), ".vev-dev-mail");
    await mkdir(dir, { recursive: true });

    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${message.to.replace(/[^a-z0-9]/gi, "_")}`;
    const header = [
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      `Date: ${new Date().toISOString()}`,
      "",
      "",
    ].join("\n");

    await writeFile(join(dir, `${id}.txt`), header + message.text, "utf8");
    await writeFile(join(dir, `${id}.html`), message.html, "utf8");

    console.info(`[e-post] Skrev til .vev-dev-mail/${id}.html — «${message.subject}» til ${message.to}`);

    const catcher = localMailCatcher();
    if (catcher) {
      const delivered = await deliverToMailCatcher(catcher, message);
      if (!delivered.ok) return delivered;
      console.info(`[e-post] Levert til lokal innboks ${catcher.origin} — «${message.subject}»`);
    }
    return { ok: true, id };
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function localMailCatcher(): URL | undefined {
  const configured = process.env.LOCAL_MAIL_CATCHER_URL;
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return url;
  } catch {
    // Fall through to the warning below.
  }
  console.warn("[e-post] LOCAL_MAIL_CATCHER_URL ignorert: bare http://localhost eller 127.0.0.1 er tillatt.");
  return undefined;
}

/** Mailpit's HTTP send API, which the local Supabase stack exposes. */
async function deliverToMailCatcher(catcher: URL, message: EmailMessage): Promise<EmailResult> {
  try {
    const response = await fetch(new URL("/api/v1/send", catcher), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // The intended production sender, as the Supabase Auth emails also show
        // locally (supabase/config.toml [local_smtp]). Mailpit delivers nothing.
        From: { Email: "ikke-svar@join-ting.no", Name: "TING" },
        To: [{ Email: message.to }],
        Subject: message.subject,
        Text: message.text,
        HTML: message.html,
      }),
    });
    if (!response.ok) return { ok: false, reason: "local", error: `Lokal innboks svarte ${response.status}` };
    return { ok: true, id: ((await response.json()) as { ID?: string }).ID ?? "mailpit" };
  } catch {
    return { ok: false, reason: "local", error: "Fant ikke den lokale innboksen. Kjører `supabase start`?" };
  }
}

/**
 * What stands in when no usable provider is configured.
 *
 * It refuses every message and says why, once, in the log — by the names of
 * the settings, never their values. An approval made meanwhile still stands;
 * the administrator is told the email was not sent and can resend it once
 * the configuration is fixed.
 */
class UnconfiguredProvider implements EmailProvider {
  readonly name = "ikke konfigurert";
  private static reported = new Set<string>();

  constructor(private readonly why: string) {}

  async send(): Promise<EmailResult> {
    if (!UnconfiguredProvider.reported.has(this.why)) {
      UnconfiguredProvider.reported.add(this.why);
      console.error(`[e-post] Ingen e-post kan sendes: ${this.why}`);
    }
    return emailFailure("configuration");
  }
}

/**
 * Chooses the provider from `EMAIL_PROVIDER`.
 *
 *   smtp   real delivery through an SMTP server (lib/email/smtp.ts)
 *   fil    the development provider above: files, and the local mail catcher
 *
 * Unset means `fil` under `next dev` and in scripts, and means *nothing* in a
 * production build: a server that was never told how to send mail refuses,
 * rather than quietly writing invitation links to its own disk and reporting
 * them sent. For the same reason `fil` has to be asked for by name there, and
 * is only honoured on a showcase deployment (`TING_MODE=demo`).
 */
export function getEmailProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  const configured = env.EMAIL_PROVIDER?.trim().toLowerCase();
  const production = env.NODE_ENV === "production";

  if (configured === "smtp") {
    const smtp = smtpConfigFromEnv(env);
    return smtp.ok
      ? new SmtpEmailProvider(smtp.config)
      : new UnconfiguredProvider(`EMAIL_PROVIDER=smtp, men ${smtp.problems.join("; ")}.`);
  }

  if (configured === "fil" || configured === "file" || configured === "dev") {
    if (production && !isDemoDeployment()) {
      return new UnconfiguredProvider(
        "EMAIL_PROVIDER=fil skriver e-post til disk og er ikke tillatt i produksjon. Sett EMAIL_PROVIDER=smtp.",
      );
    }
    return new FileEmailProvider();
  }

  if (configured === undefined || configured === "") {
    return production
      ? new UnconfiguredProvider("EMAIL_PROVIDER er ikke satt. Sett EMAIL_PROVIDER=smtp og SMTP_*-variablene.")
      : new FileEmailProvider();
  }

  return new UnconfiguredProvider(`EMAIL_PROVIDER har en ukjent verdi. Gyldige verdier er smtp og fil.`);
}
