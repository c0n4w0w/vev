import { getEmailProvider, type EmailResult } from "@/lib/email/provider";

/**
 * The invitation email.
 *
 * Two things it is careful about. It names VEV as a separate service, because
 * the recipient asked an organisation for access and is about to receive mail
 * from something they have never heard of — and because VEV does not manage
 * anyone's formal membership of that organisation and must not imply it does.
 *
 * And it mentions exactly one community: the one being invited to. A person
 * with no VEV account should not learn from an email that other communities
 * exist here.
 */
export interface InvitationEmailInput {
  to: string;
  communityName: string;
  /** Absolute URL carrying the token. The token is the only secret in it. */
  acceptUrl: string;
  expiresAt: string;
  /** The community's accent, used sparingly so the mail looks like theirs. */
  accent: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildInvitationEmail(input: InvitationEmailInput) {
  const expires = new Intl.DateTimeFormat("nb-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Oslo",
  }).format(new Date(input.expiresAt));

  const subject = `Du er invitert til ${input.communityName} på VEV`;

  const text = [
    `Du er invitert til ${input.communityName} på VEV.`,
    "",
    `En administrator i ${input.communityName} har godkjent forespørselen din om tilgang.`,
    "",
    "Bli med:",
    input.acceptUrl,
    "",
    `Lenken virker fram til ${expires}, og kan bare brukes én gang.`,
    "",
    "— — —",
    "",
    "VEV er en egen digital plattform som organisasjoner bruker til å drive",
    `fellesskapet sitt. VEV er ikke det samme som ${input.communityName}, og`,
    "styrer ikke det formelle medlemskapet ditt i organisasjonen.",
    "",
    "Har du ikke bedt om dette, kan du se bort fra e-posten. Da skjer det",
    "ingenting, og ingen konto blir opprettet.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="nb"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:32px 16px;background:#f6f4ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#17191a;">
  <table role="presentation" style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e0d7;border-radius:6px;border-collapse:separate;">
    <tr><td style="height:4px;background:${escapeHtml(input.accent)};border-radius:6px 6px 0 0;"></td></tr>
    <tr><td style="padding:32px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#797e81;">Invitasjon</p>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;font-weight:600;">
        Du er invitert til ${escapeHtml(input.communityName)} på VEV
      </h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4c5153;">
        En administrator i ${escapeHtml(input.communityName)} har godkjent forespørselen din om tilgang.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${escapeHtml(input.acceptUrl)}"
           style="display:inline-block;background:${escapeHtml(input.accent)};color:#fff;text-decoration:none;padding:11px 20px;border-radius:5px;font-size:15px;font-weight:500;">
          Bli med på VEV
        </a>
      </p>
      <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#797e81;">
        Lenken virker fram til ${escapeHtml(expires)}, og kan bare brukes én gang.
      </p>
      <hr style="border:0;border-top:1px solid #e4e0d7;margin:0 0 20px;">
      <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#797e81;">
        VEV er en egen digital plattform som organisasjoner bruker til å drive fellesskapet sitt.
        VEV er ikke det samme som ${escapeHtml(input.communityName)}, og styrer ikke det formelle
        medlemskapet ditt i organisasjonen.
      </p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#797e81;">
        Har du ikke bedt om dette, kan du se bort fra e-posten. Da skjer det ingenting,
        og ingen konto blir opprettet.
      </p>
    </td></tr>
  </table>
</body></html>`;

  return { to: input.to, subject, text, html };
}

export function sendInvitationEmail(input: InvitationEmailInput): Promise<EmailResult> {
  return getEmailProvider().send(buildInvitationEmail(input));
}
