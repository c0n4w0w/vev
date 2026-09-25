import { getEmailProvider, type EmailResult } from "@/lib/email/provider";
import { formatFullDate } from "@/lib/format";
import { PLATFORM_LOCALE, translator, type Locale } from "@/lib/i18n";

/**
 * The claim-link email.
 *
 * Sent only to an address with no usable TING account yet — someone whose
 * address already has one is activated the moment an administrator approves
 * their request, and gets no email at all. So this message is careful to say
 * what is actually true for its one recipient: the request was already
 * decided. It is a login/account-creation step, not a second decision, and
 * the copy avoids "invitation" and "accept" for exactly that reason.
 *
 * Two other things it is careful about. It names TING as a separate service,
 * because the recipient asked an organisation for access and is about to
 * receive mail from something they have never heard of — and because TING
 * does not manage anyone's formal membership of that organisation and must
 * not imply it does.
 *
 * And it mentions exactly one community: the one access was approved for. A
 * person with no TING account should not learn from an email that other
 * communities exist here.
 */
export interface InvitationEmailInput {
  to: string;
  communityName: string;
  /** Absolute URL carrying the token. The token is the only secret in it. */
  acceptUrl: string;
  expiresAt: string;
  /** The community's accent, used sparingly so the mail looks like theirs. */
  accent: string;
  /**
   * The language the message is written in: the community's own, since the
   * mail is about that one community. The wording lives in the shared
   * dictionaries (`email.invitation.*`).
   */
  locale?: Locale;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildInvitationEmail(input: InvitationEmailInput) {
  const locale = input.locale ?? PLATFORM_LOCALE;
  const t = translator(locale);
  const community = input.communityName;
  const expires = formatFullDate(input.expiresAt, locale);

  const subject = t("email.invitation.subject", { community });

  const text = [
    t("email.invitation.intro", { community }),
    "",
    t("email.invitation.body", { community }),
    "",
    t("email.invitation.loginLabel"),
    input.acceptUrl,
    "",
    t("email.invitation.expires", { date: expires }),
    "",
    "— — —",
    "",
    t("email.invitation.about", { community }),
    "",
    t("email.invitation.ignore"),
  ].join("\n");

  const html = `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:32px 16px;background:#f6f4ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#17191a;">
  <table role="presentation" style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e0d7;border-radius:6px;border-collapse:separate;">
    <tr><td style="height:4px;background:${escapeHtml(input.accent)};border-radius:6px 6px 0 0;"></td></tr>
    <tr><td style="padding:32px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#797e81;">${escapeHtml(t("email.invitation.badge"))}</p>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;font-weight:600;">
        ${escapeHtml(subject)}
      </h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4c5153;">
        ${escapeHtml(t("email.invitation.body", { community }))}
      </p>
      <p style="margin:0 0 24px;">
        <a href="${escapeHtml(input.acceptUrl)}"
           style="display:inline-block;background:${escapeHtml(input.accent)};color:#fff;text-decoration:none;padding:11px 20px;border-radius:5px;font-size:15px;font-weight:500;">
          ${escapeHtml(t("email.invitation.button"))}
        </a>
      </p>
      <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#797e81;">
        ${escapeHtml(t("email.invitation.expires", { date: expires }))}
      </p>
      <hr style="border:0;border-top:1px solid #e4e0d7;margin:0 0 20px;">
      <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#797e81;">
        ${escapeHtml(t("email.invitation.about", { community }))}
      </p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#797e81;">
        ${escapeHtml(t("email.invitation.ignore"))}
      </p>
    </td></tr>
  </table>
</body></html>`;

  return { to: input.to, subject, text, html };
}

export function sendInvitationEmail(input: InvitationEmailInput): Promise<EmailResult> {
  return getEmailProvider().send(buildInvitationEmail(input));
}
