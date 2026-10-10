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

export type EmailResult = { ok: true; id: string } | { ok: false; error: string };

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
    if (!response.ok) return { ok: false, error: `Lokal innboks svarte ${response.status}` };
    return { ok: true, id: ((await response.json()) as { ID?: string }).ID ?? "mailpit" };
  } catch {
    return { ok: false, error: "Fant ikke den lokale innboksen. Kjører `supabase start`?" };
  }
}

/**
 * Placeholder for a real provider.
 *
 * Deliberately unimplemented: wiring one in is a decision about a vendor, a
 * sending domain and a set of secrets, none of which should be made silently
 * by a prototype. Configuring EMAIL_PROVIDER without implementing this fails
 * loudly rather than quietly dropping invitations on the floor.
 */
class UnconfiguredProvider implements EmailProvider {
  constructor(private readonly requested: string) {}
  readonly name = "ikke konfigurert";

  async send(): Promise<EmailResult> {
    return {
      ok: false,
      error: `E-postleverandøren «${this.requested}» er ikke implementert. Sett EMAIL_PROVIDER=fil for lokal utvikling.`,
    };
  }
}

export function getEmailProvider(): EmailProvider {
  const configured = (process.env.EMAIL_PROVIDER ?? "fil").toLowerCase();
  if (configured === "fil" || configured === "file" || configured === "dev") {
    return new FileEmailProvider();
  }
  return new UnconfiguredProvider(configured);
}
