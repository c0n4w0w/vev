import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions";
import { LoginSecurity } from "@/components/account/LoginSecurity";
import { LanguagePreference } from "@/components/account/LanguagePreference";
import { CommunityAvatar } from "@/components/ui/CommunityAvatar";
import {
  Avatar,
  Button,
  ButtonLink,
  Panel,
  PageContainer,
  PageHeader,
  SectionHeading,
} from "@/components/ui/primitives";
import { getAccountSecurity } from "@/lib/account-security";
import { getCommunitiesForUser, getMyCommunityPersonas } from "@/lib/data";
import { parseLocale, translator } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/react";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({ searchParams }: PageProps<"/profile">): Promise<Metadata> {
  const t = translator(await getRequestLocale(parseLocale((await searchParams).locale)));
  return { title: t("account.title") };
}

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const locale = await getRequestLocale(parseLocale(query.locale));
  const t = translator(locale);
  const [communities, personas, security] = await Promise.all([
    getCommunitiesForUser(user.id),
    getMyCommunityPersonas(user.id),
    getAccountSecurity(),
  ]);

  return (
    <LocaleProvider locale={locale}>
      <PageContainer width="narrow">
        <PageHeader
          title={t("account.title")}
          action={
            <form action={signOut}>
              <Button type="submit" variant="secondary">{t("account.logout")}</Button>
            </form>
          }
        />
        <section aria-labelledby="profiles-heading">
          <h2 id="profiles-heading" className="label">{t("account.profiles")}</h2>
          <p className="mb-4 mt-2 text-sm leading-relaxed text-ink-2">{t("account.profiles.intro")}</p>
          {communities.length === 0 ? (
            <Panel className="p-4">
              <p className="text-sm font-medium text-ink">{t("account.profiles.empty.title")}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{t("account.profiles.empty.body")}</p>
            </Panel>
          ) : (
            <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">
              {communities.map(({ community }) => {
                const persona = personas.get(community.id);
                return (
                  <li
                    key={community.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                  >
                    <Link
                      href={`/community/${community.id}`}
                      className="col-span-2 flex min-w-0 items-center gap-2.5 rounded-sm text-sm font-medium text-ink hover:underline sm:col-span-1"
                    >
                      <CommunityAvatar community={community} size="sm" />
                      <span className="[overflow-wrap:anywhere]">{community.name}</span>
                    </Link>
                    <div className="flex min-w-0 items-center gap-2.5">
                      {persona ? <Avatar user={persona} size="sm" /> : null}
                      <p className="min-w-0 text-sm text-ink [overflow-wrap:anywhere]">
                        {persona?.name ?? t("account.profiles.missing")}
                      </p>
                    </div>
                    <ButtonLink
                      href={`/community/${community.id}/profile/edit`}
                      variant="secondary"
                      size="sm"
                      aria-label={t("account.profiles.editIn", { name: community.name })}
                    >
                      {t("account.profiles.edit")}
                    </ButtonLink>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {security ? (
          <LoginSecurity
            security={security}
            locale={locale}
            edit={query.edit}
            passwordSaved={query.passord === "lagret"}
          />
        ) : null}
        <LanguagePreference preference={user.preferredLocale} />
        <section className="mt-7 border-t border-line pt-6">
          <SectionHeading>{t("account.privacy")}</SectionHeading>
          <p className="text-[13px] leading-relaxed text-ink-2">{t("account.privacy.body")}</p>
          <Link
            href="/personvern"
            className="mt-2 inline-block rounded-sm text-[13px] text-ink-2 underline decoration-line-2 underline-offset-4 hover:text-ink"
          >
            {t("account.privacy.link")}
          </Link>
        </section>
      </PageContainer>
    </LocaleProvider>
  );
}
