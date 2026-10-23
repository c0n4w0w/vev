import Image from "next/image";
import Link from "next/link";
import { redeemInvitationLinkAction } from "@/app/actions";
import { AcceptInvitation } from "@/components/community/AcceptInvitation";
import { EmailLinkSignIn } from "@/components/community/EmailLinkSignIn";
import { Wordmark } from "@/components/shell/Wordmark";
import { CommunityMark, Panel, buttonClass } from "@/components/ui/primitives";
import { IconLock, IconMail } from "@/components/ui/icons";
import { getInvitationPreview, getPortalCommunity } from "@/lib/data";
import { formatFullDate } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import { translator, type Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/react";

export async function generateMetadata({ params }: PageProps<"/invitasjon/[token]">) {
  const { token } = await params;
  const preview = await getInvitationPreview(token);
  return {
    title: translator(await getRequestLocale(preview?.communityLocale))("inv.metaTitle"),
    // The URL can carry a sign-in token. Never hand it to another site.
    referrer: "no-referrer" as const,
  };
}

/**
 * Where an invitation link lands.
 *
 * The page can be opened by anyone holding the link, so it shows the least it
 * can: which community, and which address the invitation was sent to. No
 * member list, no counts, no mention of any other community — a visitor with
 * no account should not learn from this page that TING hosts anything else.
 *
 * Holding the link is not enough to join. Accepting requires a session whose
 * email matches the invited address, which the database checks.
 */
export default async function InvitationPage({
  params,
  searchParams,
}: PageProps<"/invitasjon/[token]">) {
  const { token } = await params;
  // The Supabase sign-in token an approval email adds. Opening the page never
  // uses it; only the button below does (see EmailLinkSignIn).
  const { innlogging } = await searchParams;
  const signInToken = typeof innlogging === "string" && innlogging ? innlogging : undefined;
  const preview = await getInvitationPreview(token);
  const user = await getSessionUser();

  // The page speaks the language of the community the invitation is for. A
  // token that names nothing (spent, expired, invented) has no community to
  // borrow one from, and reads in the platform's.
  const locale = await getRequestLocale(preview?.communityLocale);
  const t = translator(locale);

  if (!preview) {
    return (
      <Shell locale={locale}>
        <h1 className="font-display text-[1.75rem] leading-tight text-ink">
          {t("inv.invalid.title")}
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">
          {t("inv.invalid.body")}
        </p>
        <Link href="/" className={`${buttonClass({ variant: "secondary" })} mt-8`}>
          {t("inv.toFront")}
        </Link>
      </Shell>
    );
  }

  // Branding comes from the public portal record for the slug the preview
  // returned — the same data any visitor to that portal can see, and only for
  // the one community this invitation names.
  const community = await getPortalCommunity(preview.communitySlug);
  const accent = community?.branding.accent ?? "#1f4a3d";
  const signedInAs = user?.email?.toLowerCase();
  const matches = signedInAs === preview.email.toLowerCase();

  // A request-derived link means access was already approved — the visitor
  // decided when they asked, and an administrator decided when they approved.
  // Logging in here is proof of identity, not a second decision, so the copy
  // and the accept step below both avoid asking "do you want this".
  // An administrator invitation comes from TING itself, not from an answered
  // request, and says so.
  const admin = preview.invitedRole === "admin";
  const label = admin ? t("inv.label.admin") : preview.autoActivate ? t("inv.label.approved") : t("inv.label.invitation");
  const lede = admin ? t("inv.lede.admin") : preview.autoActivate ? t("inv.lede.approved") : t("inv.lede.invited");
  const loginForInvitation = `/login?e=${encodeURIComponent(preview.email)}&neste=${encodeURIComponent(`/invitasjon/${token}`)}`;
  const recovery = {
    title: t("inv.link.expired.title"),
    body: t("inv.link.expired.body"),
    href: loginForInvitation,
    action: t("inv.link.expired.action"),
  };

  return (
    <Shell locale={locale}>
      <p className="label">{label}</p>
      <p className="mt-4 text-[0.9375rem] text-ink-2">{lede}</p>
      <div className="mt-3 flex items-center gap-3">
        {community?.slug === "under-the-rug" ? (
          <Image
            src="/brand/under-the-rug-logo.png"
            alt=""
            width={80}
            height={80}
            className="h-11 w-11 shrink-0"
          />
        ) : community ? (
          <CommunityMark community={community} size="md" />
        ) : null}
        <h1 className="font-display text-[2rem] leading-tight text-ink">
          {preview.communityName}
          {preview.autoActivate && !admin ? t("inv.approvedSuffix") : ""}
        </h1>
      </div>
      <p className="mt-2 text-[0.9375rem] text-ink-2">
        {t("inv.runsOnTing")}
      </p>

      <Panel className="mt-8 p-5">
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-2">
          <IconMail size={14} className="mt-0.5 shrink-0 text-ink-3" />
          {/* One inline run of text: as direct flex children the three pieces
              were laid out as separate columns. */}
          <span className="min-w-0">
            {preview.autoActivate ? (
              <>
                {t("inv.approvedFor")}
                <span className="break-all font-mono text-ink">{preview.email}</span>
                {t("inv.approvedAfter", { date: formatFullDate(preview.expiresAt, locale) })}
              </>
            ) : (
              <>
                {t("inv.sentTo")}
                <span className="break-all font-mono text-ink">{preview.email}</span>
                {t("inv.sentAfter", { date: formatFullDate(preview.expiresAt, locale) })}
              </>
            )}
          </span>
        </p>
      </Panel>

      <div className="mt-6">
        {!user && signInToken ? (
          // One email: the link already carries a Supabase sign-in token.
          <LocaleProvider locale={locale}>
            <p className="mb-4 text-[0.9375rem] leading-relaxed text-ink-2">{t("inv.link.lead")}</p>
            <EmailLinkSignIn
              action={redeemInvitationLinkAction}
              fields={{ token, innlogging: signInToken }}
              label={t("inv.link.button")}
              accent={accent}
              recovery={recovery}
            />
          </LocaleProvider>
        ) : !user ? (
          <>
            <p className="mb-4 text-[0.9375rem] leading-relaxed text-ink-2">
              {preview.autoActivate ? t("inv.signIn.approved") : t("inv.signIn.invited")}
            </p>
            <Link href={loginForInvitation} className={buttonClass()}>
              {t("inv.continueWith", { email: preview.email })}
            </Link>
          </>
        ) : matches ? (
          <LocaleProvider locale={locale}>
            <AcceptInvitation token={token} accent={accent} auto={preview.autoActivate} />
          </LocaleProvider>
        ) : (
          <>
            <p className="mb-4 rounded-[5px] border border-rust/25 bg-rust-soft px-3 py-2.5 text-[13px] leading-relaxed text-rust">
              {t("inv.mismatch", { signedIn: signedInAs ?? "", email: preview.email })}
            </p>
            {signInToken ? (
              // Never a silent switch: the other account stays signed in until
              // this is pressed, and the invitation can only ever attach to
              // the invited address.
              <LocaleProvider locale={locale}>
                <EmailLinkSignIn
                  action={redeemInvitationLinkAction}
                  fields={{ token, innlogging: signInToken, switch: "1" }}
                  label={t("inv.link.switch", { email: preview.email })}
                  accent={accent}
                  recovery={recovery}
                />
              </LocaleProvider>
            ) : (
              <Link href="/login" className={buttonClass({ variant: "secondary" })}>
                {t("inv.switchAccount")}
              </Link>
            )}
          </>
        )}
      </div>

      <p className="mt-8 flex items-start gap-2 border-t border-line pt-5 text-[11px] leading-relaxed text-ink-3">
        <IconLock size={13} className="mt-px shrink-0" />
        {t("inv.footer", { name: preview.communityName })}
      </p>
    </Shell>
  );
}

function Shell({ children, locale }: { children: React.ReactNode; locale: Locale }) {
  return (
    <main lang={locale} className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-2xl items-center px-5 py-4 lg:px-8">
          <Link href="/">
            <Wordmark />
          </Link>
        </div>
      </header>
      <div className="mx-auto w-full max-w-2xl flex-1 px-5 py-16 lg:px-8">{children}</div>
    </main>
  );
}
