import Link from "next/link";
import { EventDateBlock } from "@/components/community/EventDateBlock";
import { CommunityAvatar } from "@/components/ui/CommunityAvatar";
import { IconArrowRight } from "@/components/ui/icons";
import { PageContainer, Panel, SectionHeading } from "@/components/ui/primitives";
import type { HomeEvent, HomeUpdate } from "@/lib/data";
import { formatEventRange, timeAgo } from "@/lib/format";
import { translator, type Locale } from "@/lib/i18n";
import type { Community } from "@/lib/types";

const linkFocus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-skog";

/** Home is a set of entry points; reading and interacting happen in the community. */
export function HomeContent({ name, communities, updates, events, locale }: {
  name: string;
  communities: Community[];
  updates: HomeUpdate[];
  events: HomeEvent[];
  locale: Locale;
}) {
  const t = translator(locale);
  const communityById = new Map(communities.map((community) => [community.id, community]));
  // Never render an orphan link or expose a public event from outside one's communities.
  const recent = updates.filter((post) => communityById.has(post.communityId)).slice(0, 3);
  const upcoming = events.filter((event) => communityById.has(event.communityId)).slice(0, 3);

  return (
    <PageContainer width="wide">
      <header className="mb-6">
        <h1 className="font-display text-xl text-ink sm:text-2xl">
          {t("platform.home.greeting", { name: name.split(" ")[0] })}
        </h1>
      </header>

      <section aria-labelledby="home-communities" className="mb-9">
        <SectionHeading><span id="home-communities">{t("platform.home.communities")}</span></SectionHeading>
        {communities.length === 0 ? (
          <div className="text-sm leading-relaxed text-ink-2">
            <p className="font-medium text-ink">{t("platform.home.empty")}</p>
            <p className="mt-1">{t("platform.home.emptyBody")}</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {communities.map((community) => (
              <li key={community.id}>
                <Link
                  href={`/community/${community.id}`}
                  className={`flex h-full items-center gap-3 rounded-[6px] border border-line bg-surface p-4 transition-colors hover:border-line-2 hover:bg-paper-2/60 ${linkFocus}`}
                >
                  <CommunityAvatar community={community} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-medium text-ink">{community.name}</span>
                    <span className="mt-1 block text-xs text-ink-2">{t("platform.home.openCommunity")}</span>
                  </span>
                  <IconArrowRight size={16} className="shrink-0 text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {communities.length > 0 ? (
        <div className="grid items-start gap-9 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-12">
          <section aria-labelledby="home-updates" className="min-w-0">
            <SectionHeading><span id="home-updates">{t("platform.home.latest")}</span></SectionHeading>
            {recent.length === 0 ? (
              <p className="text-sm text-ink-3">{t("platform.home.noUpdates")}</p>
            ) : (
              <ul className="space-y-4">
                {recent.map((post) => {
                  const community = communityById.get(post.communityId)!;
                  return (
                    <Panel as="li" key={post.id}>
                      <Link
                        href={`/community/${community.id}/feed#post-${post.id}`}
                        className={`block rounded-[6px] p-5 transition-colors hover:bg-paper-2/40 sm:p-6 ${linkFocus}`}
                      >
                        <span className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                          <span className="flex min-w-0 items-center gap-2">
                            <CommunityAvatar community={community} size="xs" />
                            <span className="break-words">{community.name}</span>
                          </span>
                          <time dateTime={post.createdAt}>{timeAgo(post.createdAt, locale)}</time>
                        </span>
                        {post.title ? <h3 className="mb-2 break-words font-display text-xl leading-snug text-ink">{post.title}</h3> : null}
                        <p className="line-clamp-2 break-words text-[0.9375rem] leading-[1.7] text-ink-2">{post.body}</p>
                      </Link>
                    </Panel>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="home-events" className="min-w-0">
            <SectionHeading><span id="home-events">{t("platform.home.upcoming")}</span></SectionHeading>
            {upcoming.length === 0 ? (
              <p className="text-sm text-ink-3">{t("platform.home.noEvents")}</p>
            ) : (
              <ul className="space-y-3">
                {upcoming.map((event) => {
                  const community = communityById.get(event.communityId)!;
                  return (
                    <Panel as="li" key={event.id}>
                      <Link
                        href={`/community/${community.id}/events/${event.id}`}
                        className={`block rounded-[6px] p-4 transition-colors hover:bg-paper-2/40 ${linkFocus}`}
                      >
                        <span className="mb-1.5 flex items-center gap-2 text-xs text-ink-3">
                          <CommunityAvatar community={community} size="2xs" />
                          <span className="break-words">{community.name}</span>
                        </span>
                        <div className="flex items-start gap-3">
                          <EventDateBlock iso={event.startsAt} accent={community.branding.accent} locale={locale} compact />
                          <div className="min-w-0 flex-1">
                            <h3 className="break-words font-display text-[0.9375rem] leading-snug text-ink">{event.title}</h3>
                            <p className="mt-1 text-xs leading-relaxed text-ink-2">
                              <time dateTime={event.startsAt}>{formatEventRange(event.startsAt, event.endsAt, locale)}</time>
                            </p>
                            {event.location ? <p className="mt-1 break-words text-xs leading-relaxed text-ink-3">{event.location}</p> : null}
                          </div>
                        </div>
                      </Link>
                    </Panel>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      <section className="mt-9 border-t border-line pt-4 text-xs leading-relaxed text-ink-3">
        <h2 className="font-medium text-ink-2">{t("home.discovery.heading")}</h2>
        <p className="mt-1">{t("home.discovery.body")}</p>
      </section>
    </PageContainer>
  );
}
