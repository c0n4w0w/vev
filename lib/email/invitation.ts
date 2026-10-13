import { getEmailProvider, type EmailResult } from "@/lib/email/provider";
import { formatFullDate, formatTime } from "@/lib/format";
import { PLATFORM_LOCALE, translator, type Locale } from "@/lib/i18n";

/**
 * The approval email — the one message a person gets when an administrator
 * says yes. A welcome, deliberately short: the TING logo, that access to this
 * one community is approved, one button, and a single line of fine print with
 * the two real expiries.
 *
 * Two recipients, one template:
 *
 * - `new`: an address with no usable TING account (one was created, still
 *   unconfirmed, when the request was approved). The link opens the
 *   invitation page, which signs in and accepts in one step.
 * - `existing`: an address with a TING account. Access is already active;
 *   the link is just a way in. Only the body line and the fine print differ.
 *
 * The fine print states exactly what the link can do: sign in directly until
 * the Supabase token expires, and — for an invitation — remain valid as an
 * invitation until its own, later expiry. Exactly one community is named.
 */
export interface InvitationEmailInput {
  to: string;
  communityName: string;
  /** Absolute URL. Carries the invitation token and, when minted, the sign-in token. */
  acceptUrl: string;
  kind: "new" | "existing";
  /** When the sign-in part of the link stops working; absent if none was minted. */
  signInExpiresAt?: string;
  /** When the invitation itself expires (`new` only). */
  invitationExpiresAt?: string;
  /** The community's accent, used sparingly so the mail looks like theirs. */
  accent: string;
  /** The community's own language — the mail is about that one community. */
  locale?: Locale;
  /**
   * Absolute origin the logo is served from (the site's own). Mail clients
   * need an absolute URL; the image is `EMAIL_LOGO.path` under it.
   */
  origin: string;
}

/**
 * The official TING horizontal lockup (logo system v2, spruce on light), as
 * the PNG export — mail clients do not reliably render SVG. Shown 170 px
 * wide (46 px tall, the file's 976:264 ratio); the file carries its own clear
 * space, and `offset` cancels its transparent left edge at this width so the
 * artwork lines up with the heading. The Supabase Auth sign-in template uses
 * the same file, size and offset.
 */
export const EMAIL_LOGO = {
  path: "/brand/ting-horizontal-spruce-976.png",
  width: 170,
  height: 46,
  offset: 3,
  alt: "TING",
} as const;

/**
 * The TING email palette and type, shared by every message TING sends — this
 * approval email, and the Supabase Auth sign-in template
 * (supabase/templates/sign-in.html), which GoTrue renders on its own and so
 * cannot import this. `npm run check:auth-email` keeps the two in step.
 */
export const EMAIL_STYLE = {
  paper: "#f6f4ef",
  surface: "#ffffff",
  line: "#e4e0d7",
  ink: "#17191a",
  ink2: "#4c5153",
  ink3: "#797e81",
  /** TING's own accent (skog). A community email uses the community's instead. */
  spruce: "#1f4a3d",
  font: "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif",
} as const;

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

  const subject = t("email.welcome.subject", { community });
  const heading = t("email.welcome.heading", { community });
  const body = t(input.kind === "new" ? "email.welcome.body" : "email.welcome.bodyExisting", { community });
  const logoSrc = escapeHtml(new URL(EMAIL_LOGO.path, input.origin).href);
  const button = t("email.welcome.button");

  // One line of fine print, built only from what the link can actually do.
  const signIn = input.signInExpiresAt
    ? {
        date: formatFullDate(input.signInExpiresAt, locale),
        time: formatTime(input.signInExpiresAt, locale),
      }
    : undefined;
  const invitationUntil =
    input.kind === "new" && input.invitationExpiresAt
      ? formatFullDate(input.invitationExpiresAt, locale)
      : undefined;
  const fine = [
    signIn ? t("email.welcome.signIn", signIn) : t("email.welcome.personal"),
    ...(invitationUntil ? [t("email.welcome.invitationUntil", { date: invitationUntil })] : []),
  ].join(" ");
  const ignore = t("email.welcome.ignore");

  const text = ["TING", "", heading, "", body, "", `${button}`, input.acceptUrl, "", fine, "", ignore].join("\n");

  const accent = escapeHtml(input.accent);
  const url = escapeHtml(input.acceptUrl);
  const font = EMAIL_STYLE.font;

  // Table layout and inline styles throughout: the subset every mail client
  // renders the same. The button is a padded table cell, so it keeps its shape
  // where clients ignore padding on links, and Outlook — which ignores
  // max-width — gets a fixed-width wrapper of its own. No hidden preheader:
  // where hiding is unsupported it would print the body line twice.
  const html = `<!doctype html>
<html lang="${locale}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL_STYLE.paper};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_STYLE.paper}" style="background:${EMAIL_STYLE.paper};">
    <tr><td align="center" style="padding:32px 16px;">
      <!--[if mso]><table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_STYLE.surface}" style="max-width:520px;background:${EMAIL_STYLE.surface};border:1px solid ${EMAIL_STYLE.line};border-radius:6px;border-collapse:separate;">
        <tr><td bgcolor="${accent}" style="height:4px;line-height:4px;font-size:4px;background:${accent};border-radius:6px 6px 0 0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 28px 8px;font-family:${font};color:${EMAIL_STYLE.ink};">
          <img src="${logoSrc}" width="${EMAIL_LOGO.width}" height="${EMAIL_LOGO.height}" alt="${EMAIL_LOGO.alt}" style="display:block;width:${EMAIL_LOGO.width}px;height:auto;max-width:100%;border:0;outline:none;text-decoration:none;margin:0 0 18px -${EMAIL_LOGO.offset}px;font-family:${font};font-size:20px;font-weight:600;color:${EMAIL_STYLE.spruce};">
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:600;color:${EMAIL_STYLE.ink};">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${EMAIL_STYLE.ink2};">${escapeHtml(body)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
            <tr><td bgcolor="${accent}" style="background:${accent};border-radius:5px;">
              <a href="${url}" style="display:inline-block;padding:12px 22px;font-family:${font};font-size:15px;font-weight:600;line-height:1.2;color:${EMAIL_STYLE.surface};text-decoration:none;border-radius:5px;">${escapeHtml(button)}</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid ${EMAIL_STYLE.line};font-family:${font};">
          <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:${EMAIL_STYLE.ink3};">${escapeHtml(fine)}</p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:${EMAIL_STYLE.ink3};">${escapeHtml(ignore)}</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body></html>`;

  return { to: input.to, subject, text, html };
}

/** True when `url` is an http(s) address on exactly `origin`. */
function leadsTo(url: string, origin: string): boolean {
  try {
    const target = new URL(url);
    return /^https?:$/.test(target.protocol) && target.origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * Sends the approval email to the one address the database returned for it.
 *
 * The button is the only link in the message and it carries the invitation,
 * so it is checked once more here, where every caller passes: it must lead to
 * this site's own origin. Anything else is a bug upstream, and is refused
 * rather than mailed.
 */
export function sendInvitationEmail(input: InvitationEmailInput): Promise<EmailResult> {
  if (!leadsTo(input.acceptUrl, input.origin)) {
    console.error("[e-post] Invitasjonen ble ikke sendt: lenken peker ikke til nettstedets egen adresse.");
    return Promise.resolve({
      ok: false,
      reason: "configuration",
      error: "Lenken i invitasjonen peker ikke til nettstedets egen adresse.",
    });
  }
  return getEmailProvider().send(buildInvitationEmail(input));
}
