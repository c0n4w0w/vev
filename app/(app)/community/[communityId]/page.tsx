import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CommunityAboutSection } from "@/components/community/CommunityAboutSection";
import { RelatedCommunityCard } from "@/components/community/RelatedCommunityCard";
import { EventCard } from "@/components/community/EventCard";
import { PostCard } from "@/components/community/PostCard";
import {
  Badge,
  ElevatedRoleBadge,
  Panel,
  PageContainer,
  SectionHeading,
  cn,
} from "@/components/ui/primitives";
import { CommunityAvatar } from "@/components/ui/CommunityAvatar";
import {
  IconArrowRight,
  IconGlobe,
  IconHash,
  IconLock,
  IconMapPin,
  IconUsers,
} from "@/components/ui/icons";
import {
  getAnnouncements,
  getCommentsForPosts,
  getCommunityById,
  getCommunityEmojis,
  getFeed,
  getGroupedChannels,
  getLatestMessage,
  getMembership,
  getRelatedCommunity,
  getUpcomingCommunityEvents,
  getCommunityPersonas,
} from "@/lib/data";
import { PUBLIC_HOST } from "@/lib/brand";
import { timeAgo } from "@/lib/format";
import { communityLocale, communityTranslator, tn, translator } from "@/lib/i18n";
import { publicMemberTitle } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  return { title: community?.name ?? communityTranslator(community)("common.communityFallback") };
}

export default async function CommunityOverviewPage({
  params,
}: PageProps<"/community/[communityId]">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();
  const locale = communityLocale(community);
  const t = translator(locale);

  const [membership, announcements, allPosts, upcoming, groups, customEmojis, related] = await Promise.all([
    getMembership(user.id, community.id),
    getAnnouncements(community.id),
    getFeed(community.id),
    getUpcomingCommunityEvents(community.id),
    getGroupedChannels(community.id),
    // Once for the page: every post card below shares it.
    getCommunityEmojis(community.id),
    // Only the two configured Tryggere communities have one; others get undefined.
    getRelatedCommunity(user.id, community.slug),
  ]);

  const pinned = announcements.find((post) => post.pinned);
  const feed = allPosts.filter((post) => post.id !== pinned?.id).slice(0, 2);
  const events = upcoming.slice(0, 2);
  const accent = community.branding.accent;
  const membershipTitle = publicMemberTitle(membership?.title);

  // The cards below are the same interactive PostCard the feed renders, so
  // they get the same inputs: who is looking, their role, the comments (one
  // query for all cards) and everyone those comments name.
  const shownPosts = [...(pinned ? [pinned] : []), ...feed];
  const commentsByPost = await getCommentsForPosts(shownPosts.map((post) => post.id));

  const people = await getCommunityPersonas(community.id, [
    ...new Set([
      user.id,
      ...[...commentsByPost.values()].flat().map((comment) => comment.authorId),
      ...feed.map((post) => post.authorId),
      ...events.map((event) => event.hostId).filter(Boolean),
      ...(pinned ? [pinned.authorId] : []),
    ]),
  ]);

  const interaction = (postId: string) => ({
    viewer: people.get(user.id)!,
    viewerRole: membership?.role,
    comments: commentsByPost.get(postId) ?? [],
    commentAuthors: Object.fromEntries(people),
    customEmojis,
  });

  // Last activity per channel, for the sidebar list.
  const channelActivity = new Map(
    await Promise.all(
      groups
        .flatMap((group) => group.channels)
        .map(async (channel) => {
          const latest = await getLatestMessage(channel.id);
          return [channel.id, latest?.createdAt] as const;
        }),
    ),
  );

  return (
    <>
      {/* Community masthead — the one place branding is allowed to be loud. */}
      <div
        className="border-b border-line"
        style={{ backgroundColor: `${accent}0d` }}
      >
        <div className="mx-auto max-w-6xl px-5 py-8 lg:px-10 lg:py-12">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <CommunityAvatar community={community} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">
                  <IconLock size={11} />
                  {community.accessPolicy === "invite-only"
                    ? t("overview.access.inviteOnly")
                    : t("overview.access.requests")}
                </Badge>
                {membership ? <ElevatedRoleBadge role={membership.role} locale={locale} /> : null}
                {membershipTitle ? <Badge tone="outline">{membershipTitle}</Badge> : null}
              </div>
              <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">
                {community.name}
              </h1>
              <p className="mt-1.5 text-[0.9375rem] text-ink-2">{community.tagline}</p>
              <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-2">
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">{t("overview.location")}</dt>
                  <IconMapPin size={14} className="text-ink-3" />
                  <dd>{community.location}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">{t("overview.members")}</dt>
                  <IconUsers size={14} className="text-ink-3" />
                  <dd>{tn(locale, "count.members", community.memberCount)}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">{t("overview.publicPortal")}</dt>
                  <IconGlobe size={14} className="text-ink-3" />
                  <dd>
                    <Link
                      href={`/${community.slug}`}
                      className="underline decoration-line-2 underline-offset-4 transition-colors hover:text-ink"
                    >
                      {PUBLIC_HOST}/{community.slug}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="sr-only">{t("overview.founded")}</dt>
                  <dd>{t("overview.since", { year: community.foundedYear })}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>

      <PageContainer width="wide" className="py-8 lg:py-10">
        {/*
          The single mobile column needs `minmax(0,1fr)` for the same reason the
          two desktop ones have it. An implicit grid track is sized `auto`,
          which floors at the widest child's min-content width, and the sidebar
          contains channel descriptions set in `truncate` — `white-space:
          nowrap`, whose min-content is the whole unwrapped sentence. The track
          grew to fit it (444px inside a 335px container) and took the page with
          it. With a 0 floor the track shrinks and the descriptions ellipsis as
          they were meant to.
        */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-12">
          <div className="space-y-10">
            <CommunityAboutSection
              communityId={community.id}
              about={community.about}
              canEdit={membership?.role === "admin" && membership.status === "active"}
              accent={accent}
            />

            {pinned ? (
              <section>
                <SectionHeading
                  action={
                    <Link
                      href={`/community/${community.id}/feed`}
                      className="inline-flex items-center gap-1 text-xs text-ink-2 transition-colors hover:text-ink"
                    >
                      {t("overview.openFeed")}
                      <IconArrowRight size={13} />
                    </Link>
                  }
                >
                  {t("overview.pinnedAnnouncement")}
                </SectionHeading>
                <PostCard
                  post={pinned}
                  author={people.get(pinned.authorId)!}
                  community={community}
                  {...interaction(pinned.id)}
                />
              </section>
            ) : null}

            <section>
              <SectionHeading
                action={
                  <Link
                    href={`/community/${community.id}/feed`}
                    className="inline-flex items-center gap-1 text-xs text-ink-2 transition-colors hover:text-ink"
                  >
                    {t("overview.fullFeed")}
                    <IconArrowRight size={13} />
                  </Link>
                }
              >
                {t("overview.recentActivity")}
              </SectionHeading>
              <div className="space-y-4">
                {feed.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    author={people.get(post.authorId)!}
                    community={community}
                    {...interaction(post.id)}
                  />
                ))}
              </div>
            </section>
          </div>

          <aside className="space-y-10">
            <section>
              <SectionHeading
                action={
                  <Link
                    href={`/community/${community.id}/events`}
                    className="text-xs text-ink-2 transition-colors hover:text-ink"
                  >
                    {t("common.all")}
                  </Link>
                }
              >
                {t("overview.upcomingEvents")}
              </SectionHeading>
              {events.length === 0 ? (
                <p className="text-sm text-ink-3">{t("overview.nothingPlanned")}</p>
              ) : (
                <div className="space-y-3">
                  {events.map((event) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      community={community}
                      host={people.get(event.hostId)}
                      attending={event.attending}
                      variant="compact"
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionHeading>{t("overview.channels")}</SectionHeading>
              <Panel className="divide-y divide-line">
                {groups.flatMap(({ channels }) =>
                  channels.map((channel) => {
                    const latestAt = channelActivity.get(channel.id);
                    return (
                      <Link
                        key={channel.id}
                        href={`/community/${community.id}/channel/${channel.id}`}
                        className="block px-4 py-3 transition-colors hover:bg-paper-2/60"
                      >
                        <span className="flex items-center gap-1.5">
                          <IconHash size={14} className="shrink-0 text-ink-3" />
                          <span className="truncate text-[13px] font-medium text-ink">
                            {channel.name}
                          </span>
                          {latestAt ? (
                            <span className="ml-auto shrink-0 text-[11px] text-ink-3">
                              {timeAgo(latestAt, locale)}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block truncate text-[12px] text-ink-3">
                          {channel.purpose}
                        </span>
                      </Link>
                    );
                  }),
                )}
              </Panel>
            </section>

            {related ? (
              <section>
                <SectionHeading>{t("overview.related.heading")}</SectionHeading>
                <RelatedCommunityCard related={related} t={t} />
              </section>
            ) : null}

            <p
              className={cn(
                "flex items-start gap-2 rounded-[6px] border border-line px-4 py-3 text-[11px] leading-relaxed text-ink-3",
              )}
            >
              <IconLock size={13} className="mt-px shrink-0" />
              {t("overview.privacyNote", {
                url: `${PUBLIC_HOST}/${community.slug}`,
                name: community.name,
              })}
            </p>
          </aside>
        </div>
      </PageContainer>
    </>
  );
}
