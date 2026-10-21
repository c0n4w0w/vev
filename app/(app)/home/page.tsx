import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HomeContent } from "@/components/home/HomeContent";
import { getCommunitiesForUser, getHomeEvents, getHomeUpdates } from "@/lib/data";
import { getRequestLocale, getRequestTranslator } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getRequestTranslator())("shell.platform.home") };
}

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // All reads use the caller's session and existing row-level visibility rules.
  const [memberships, locale] = await Promise.all([
    getCommunitiesForUser(user.id),
    getRequestLocale(),
  ]);

  const communityIds = memberships.map(({ community }) => community.id);
  const [updates, events] = await Promise.all([
    getHomeUpdates(communityIds),
    getHomeEvents(communityIds),
  ]);

  return (
    <HomeContent
      name={user.name}
      communities={memberships.map(({ community }) => community)}
      updates={updates}
      events={events}
      locale={locale}
    />
  );
}
