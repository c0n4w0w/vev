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
    return { ok: true, id };
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
