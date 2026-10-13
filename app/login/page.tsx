import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { sendMagicLink } from "@/app/actions";
import { PasswordSignInForm } from "@/components/account/PasswordSignInForm";
import { Wordmark } from "@/components/shell/Wordmark";
import { Button, Panel } from "@/components/ui/primitives";
import { IconArrowRight } from "@/components/ui/icons";
import { getSessionUser } from "@/lib/session";
import { getLocaleForDestination } from "@/lib/data";
import { resolveLocale, tn, translator, type Locale, type MessageKey } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n/react";
import { emailSignInLinkLifetimeSeconds } from "@/lib/email-sign-in-link";
import { safeInternalPath } from "@/lib/safe-path";

/**
 * The sign-in page belongs to no community, so by itself it is in the
 * platform's language. When `neste` safely names a place inside one — its
 * portal, an invitation, its private area — it takes that community's
 * language instead, so someone arriving from Under The Rug is not asked to
 * sign in in Norwegian. `neste` has already been through `safeInternalPath`.
 */
const localeForNext = cache(async (nextPath: string) =>
  resolveLocale({ community: await getLocaleForDestination(nextPath) }),
);

function nextParam(value: string | string[] | undefined) {
  return safeInternalPath(typeof value === "string" ? value : undefined);
}

export async function generateMetadata({ searchParams }: PageProps<"/login">): Promise<Metadata> {
  const { neste } = await searchParams;
  const locale = await localeForNext(nextParam(neste));
  return { title: translator(locale)("login.metaTitle") };
}

/** Error codes the sign-in flow redirects back with, and the words for each. */
const ERROR_KEYS: Record<string, MessageKey> = {
  "e-post": "login.err.email",
  lenke: "login.err.link",
};

/** "Valid for 24 hours", from the configured lifetime; minutes below an hour. */
function linkLifetime(locale: Locale, seconds: number) {
  if (seconds < 3600) {
    return tn(locale, "login.linkLastsMinutes", Math.max(1, Math.round(seconds / 60)));
  }
  return tn(locale, "login.linkLasts", Math.round(seconds / 3600));
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const current = await getSessionUser();
  const nextPath = nextParam(params.neste);
  const locale = await localeForNext(nextPath);
  const t = translator(locale);
  const sentTo = typeof params.sendt === "string" ? params.sendt : undefined;
  // A code, never text taken from the address bar: an unknown value reads as a
  // generic failure rather than being shown back to the person.
  const error =
    typeof params.feil === "string" ? t(ERROR_KEYS[params.feil] ?? "login.err.generic") : undefined;
  // Prefilled when arriving from an invitation, so the address the invitation
  // was sent to is the one that gets used. It is a convenience only: the
  // invitation is bound to that address in the database regardless of what is
  // typed here.
  const prefill = typeof params.e === "string" ? params.e : undefined;
  // Arriving from an invitation usually means arriving without an account. The
  // flow is the same magic link either way — it creates the account on first
  // use — so only the words change: "welcome back" would be wrong, and "if you
  // have an account" reads as "nothing is coming". Neither variant says
  // anything about whether an account exists for the address.
  const invited = nextPath.startsWith("/invitasjon/");
  // Two ways in, one account. Password is the form people meet; the emailed
  // link is one click away and is what an invitation leads with, because
  // someone on their way to accept one has no password yet. A link that came
  // back refused (`feil`) is answered where a new one can be asked for.
  const method = typeof params.metode === "string" ? params.metode : undefined;
  const byLink =
    method === "lenke" || typeof params.feil === "string" || (invited && method !== "passord");
  const loginHref = (wanted: "lenke" | "passord") =>
    `/login?${new URLSearchParams({ metode: wanted, ...(prefill ? { e: prefill } : {}), neste: nextPath })}`;

  return (
    <main lang={locale} className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4 lg:px-8">
          <Link href="/">
            <Wordmark />
          </Link>
          {current ? (
            <Link href="/home" className="text-sm text-ink-2 transition-colors hover:text-ink">
              {t("login.continueAs", { name: current.name.split(" ")[0] })}
            </Link>
          ) : null}
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 lg:px-8 lg:py-20">
        {sentTo ? (
          <>
            <p className="label">{t("login.label")}</p>
            <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">
              {t("login.sent.title")}
            </h1>
            <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">
              {t(invited ? "login.sent.invited.pre" : "login.sent.pre")}
              <span className="text-ink [overflow-wrap:anywhere]">{sentTo}</span>
              {t("login.sent.post")}
            </p>
            <p className="mt-2 text-[13px] text-ink-3">
              {/* Supabase's email OTP lifetime — the same setting the approval email reads. */}
              {linkLifetime(locale, emailSignInLinkLifetimeSeconds())}
            </p>
            {/* Back to the form with the same destination, so an invitation or
                community return survives a mistyped address. `nextPath` has
                already been through `safeInternalPath`. */}
            <Link
              href={`/login?metode=lenke&neste=${encodeURIComponent(nextPath)}`}
              className="mt-6 inline-block text-[13px] text-ink-2 underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink"
            >
              {t("login.sent.another")}
            </Link>
          </>
        ) : (
          <>
            <p className="label">{t(invited ? "login.invited.label" : "login.label")}</p>
            <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">
              {t(invited ? "login.invited.title" : "login.password.title")}
            </h1>
            {byLink ? (
              <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">
                {t(invited ? "login.invited.lead" : "login.link.lead")}
              </p>
            ) : null}

            {byLink ? (
              <Panel className="mt-8 p-5 sm:p-6">
                <form action={sendMagicLink} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <input type="hidden" name="next" value={nextPath} />
                  <div className="flex-1">
                    <label htmlFor="email" className="label">
                      {t("login.emailLabel")}
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      defaultValue={prefill}
                      placeholder={t("login.emailPlaceholder")}
                      className="mt-2 h-11 w-full rounded-[5px] border border-line-2 bg-surface px-3 text-[0.9375rem] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink-3"
                    />
                  </div>
                  <Button type="submit" size="lg" className="shrink-0">
                    {t("login.send")}
                    <IconArrowRight size={16} />
                  </Button>
                </form>
                {error ? (
                  <p className="mt-3 text-[13px] text-rust">{t("login.error", { error })}</p>
                ) : null}
                <p className="mt-5 border-t border-line pt-4 text-[13px] text-ink-2">
                  <Link
                    href={loginHref("passord")}
                    className="underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink"
                  >
                    {t("login.usePassword")}
                  </Link>
                </p>
              </Panel>
            ) : (
              <Panel className="mt-8 max-w-xl p-5 sm:p-6">
                <LocaleProvider locale={locale}>
                  <PasswordSignInForm
                    next={nextPath}
                    email={prefill}
                    forgotHref={`/glemt-passord?neste=${encodeURIComponent(nextPath)}`}
                    linkHref={loginHref("lenke")}
                  />
                </LocaleProvider>
              </Panel>
            )}
          </>
        )}
      </div>
    </main>
  );
}
