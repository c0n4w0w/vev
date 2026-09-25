import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { sendMagicLink } from "@/app/actions";
import { Wordmark } from "@/components/shell/Wordmark";
import { Button, Panel, buttonClass } from "@/components/ui/primitives";
import { IconArrowRight, IconLock, IconMail } from "@/components/ui/icons";
import { getSessionUser } from "@/lib/session";
import { getLocaleForDestination, getPortalCommunity } from "@/lib/data";
import { resolveLocale, translator, type MessageKey } from "@/lib/i18n";
import { portalSlugOf, safeInternalPath } from "@/lib/safe-path";

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

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const current = await getSessionUser();
  const nextPath = nextParam(params.neste);
  const locale = await localeForNext(nextPath);
  const t = translator(locale);
  // When the person came from a community's own page, offer a way back to it.
  // Only a same-site `/slug` that is a real portal qualifies; the name shown
  // comes from that portal, never from the query string.
  const returnSlug = portalSlugOf(nextPath);
  const returnPortal = returnSlug ? await getPortalCommunity(returnSlug) : undefined;
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
        <p className="label">{t("login.label")}</p>
        <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">
          {t("login.title")}
        </h1>
        <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">
          {t("login.lead")}
        </p>

        {sentTo ? (
          <Panel className="mt-8 flex items-start gap-3 p-5">
            <IconMail size={18} className="mt-0.5 shrink-0 text-skog" />
            <div>
              <h2 className="text-[0.9375rem] font-medium text-ink">{t("login.sentTitle")}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                {t("login.sentPre")}
                <span className="text-ink">{sentTo}</span>
                {t("login.sentPost")}
              </p>
            </div>
          </Panel>
        ) : (
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
          </Panel>
        )}

        <div className="mt-10 flex flex-col gap-4 rounded-[6px] border border-line bg-surface p-5 sm:flex-row sm:items-start">
          <IconLock size={18} className="mt-0.5 shrink-0 text-skog" />
          <div>
            <h2 className="text-[0.9375rem] font-medium text-ink">{t("login.community.title")}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
              {t("login.community.body")}
            </p>
            <Link
              href={returnPortal ? `/${returnPortal.slug}` : "/"}
              className={`${buttonClass({ variant: "secondary", size: "sm" })} mt-4`}
            >
              {returnPortal ? t("login.backTo", { name: returnPortal.name }) : t("login.backHome")}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
