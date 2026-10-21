import type { Metadata } from "next";
import Link from "next/link";
import { enterCommunityLinkAction } from "@/app/actions";
import { EmailLinkSignIn } from "@/components/community/EmailLinkSignIn";
import { Wordmark } from "@/components/shell/Wordmark";
import { CommunityMark, buttonClass } from "@/components/ui/primitives";
import { getMembership, getPortalCommunity } from "@/lib/data";
import { translator, type Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/react";
import { getSessionUser } from "@/lib/session";

function param(value: string | string[] | undefined) {
  return typeof value === "string" && value ? value : undefined;
}

export async function generateMetadata({ searchParams }: PageProps<"/velkommen">): Promise<Metadata> {
  const portal = await portalFor(param((await searchParams).f));
  return {
    title: translator(await getRequestLocale(portal))("welcome.metaTitle"),
    // The URL carries a sign-in token. Never hand it to another site.
    referrer: "no-referrer",
  };
}

async function portalFor(slug: string | undefined) {
  return slug ? getPortalCommunity(slug) : undefined;
}

/**
 * Where an approval email to someone who already has a TING account leads.
 *
 * Their access was activated when the administrator approved; this page only
 * gets them in. It shows nothing but the community's public portal identity
 * (the same any visitor to its portal sees), and spends the email's sign-in
 * token only when the button is pressed — never on the GET a mail scanner
 * makes.
 *
 * Someone already signed in is not signed in again. If that account is a
 * member here, they simply go in; the email's link is offered as an explicit
 * "not you?" alternative, and nothing switches accounts without that click.
 */
export default async function WelcomePage({ searchParams }: PageProps<"/velkommen">) {
  const params = await searchParams;
  const signInToken = param(params.innlogging);
  const portal = await portalFor(param(params.f));
  const locale = await getRequestLocale(portal);
  const t = translator(locale);
  const user = await getSessionUser();

  if (!signInToken || !portal) {
    return (
      <Shell locale={locale}>
        <h1 className="font-display text-[1.75rem] leading-tight text-ink">{t("welcome.invalid.title")}</h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">{t("welcome.invalid.body")}</p>
        <Link href="/login" className={`${buttonClass({ variant: "secondary" })} mt-8`}>
          {t("welcome.login")}
        </Link>
      </Shell>
    );
  }

  const accent = portal.branding.accent;
  const member = user ? (await getMembership(user.id, portal.id))?.status === "active" : false;
  const recovery = {
    title: t("welcome.expired.title"),
    body: t("welcome.expired.body"),
    href: `/login?neste=${encodeURIComponent(`/community/${portal.id}`)}`,
    action: t("welcome.login"),
  };
  const fields = { innlogging: signInToken, f: portal.slug };

  return (
    <Shell locale={locale}>
      <p className="label">{t("welcome.label")}</p>
      <div className="mt-4 flex items-center gap-3">
        <CommunityMark community={portal} size="md" />
        <h1 className="font-display text-[2rem] leading-tight text-ink">
          {t("welcome.title", { name: portal.name })}
        </h1>
      </div>

      <div className="mt-8">
        <LocaleProvider locale={locale}>
          {user && member ? (
            <>
              <p className="mb-4 text-[0.9375rem] leading-relaxed text-ink-2">
                {t("welcome.signedIn", { email: user.email ?? "" })}
              </p>
              <Link
                href={`/community/${portal.id}`}
                className="flex h-11 w-full items-center justify-center rounded-[5px] px-4 text-sm font-medium text-white"
                style={{ backgroundColor: accent }}
              >
                {t("welcome.go", { name: portal.name })}
              </Link>
              <div className="mt-4 text-center">
                <EmailLinkSignIn
                  action={enterCommunityLinkAction}
                  fields={fields}
                  label={t("welcome.notYou")}
                  accent={accent}
                  quiet
                  recovery={recovery}
                />
              </div>
            </>
          ) : user ? (
            <>
              <p className="mb-4 rounded-[5px] border border-rust/25 bg-rust-soft px-3 py-2.5 text-[13px] leading-relaxed text-rust">
                {t("welcome.notMember", { email: user.email ?? "", name: portal.name })}
              </p>
              <EmailLinkSignIn
                action={enterCommunityLinkAction}
                fields={fields}
                label={t("welcome.useLink")}
                accent={accent}
                recovery={recovery}
              />
            </>
          ) : (
            <>
              <p className="mb-4 text-[0.9375rem] leading-relaxed text-ink-2">{t("welcome.lead")}</p>
              <EmailLinkSignIn
                action={enterCommunityLinkAction}
                fields={fields}
                label={t("inv.link.button")}
                accent={accent}
                recovery={recovery}
              />
            </>
          )}
        </LocaleProvider>
      </div>

      <p className="mt-8 border-t border-line pt-5 text-[11px] leading-relaxed text-ink-3">
        {t("inv.footer", { name: portal.name })}
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
