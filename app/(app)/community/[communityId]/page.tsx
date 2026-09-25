import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventCard } from "@/components/community/EventCard";
import { PostCard } from "@/components/community/PostCard";
import {
  Avatar,
  Badge,
  ElevatedRoleBadge,
  Panel,
  PageContainer,
  RichText,
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
  getCommunityById,
  getCommunityMembers,
  getFeed,
  getGroupedChannels,
  getLatestMessage,
  getMembership,
  getUpcomingCommunityEvents,
  getCommunityPersonas,
} from "@/lib/data";
import { PUBLIC_HOST } from "@/lib/brand";
import { plural, timeAgo } from "@/lib/format";
import { publicMemberTitle } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  return { title: community?.name ?? "Fellesskap" };
}

export default async function CommunityOverviewPage({
  params,
}: PageProps<"/community/[communityId]">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();

  const [membership, members, announcements, allPosts, upcoming, groups] = await Promise.all([
    getMembership(user.id, community.id),
    getCommunityMembers(community.id),
    getAnnouncements(community.id),
    getFeed(community.id),
    getUpcomingCommunityEvents(community.id),
    getGroupedChannels(community.id),
  ]);

  const leaders = members.filter((entry) => entry.membership.role !== "member");
  const pinned = announcements.find((post) => post.pinned);
  const feed = allPosts.filter((post) => post.id !== pinned?.id).slice(0, 2);
  const events = upcoming.slice(0, 2);
  const accent = community.branding.accent;
  const membershipTitle = publicMemberTitle(membership?.title);

  const people = await getCommunityPersonas(community.id, [
    ...new Set([
      ...feed.map((post) => post.authorId),
      ...events.map((event) => event.hostId).filter(Boolean),
      ...(pinned ? [pinned.authorId] : []),
    ]),
  ]);

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
                    ? "Lukket · kun ved invitasjon"
                    : "Lukket · tar imot søknader"}
                </Badge>
                {membership ? <ElevatedRoleBadge role={membership.role} /> : null}
                {membershipTitle ? <Badge tone="outline">{membershipTitle}</Badge> : null}
              </div>
              <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">
                {community.name}
              </h1>
              <p className="mt-1.5 text-[0.9375rem] text-ink-2">{community.tagline}</p>
              <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-2">
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Sted</dt>
                  <IconMapPin size={14} className="text-ink-3" />
                  <dd>{community.location}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Medlemmer</dt>
                  <IconUsers size={14} className="text-ink-3" />
                  <dd>{plural(community.memberCount, "medlem", "medlemmer")}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Offentlig portal</dt>
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
                  <dt className="sr-only">Stiftet</dt>
                  <dd>Siden {community.foundedYear}</dd>
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
            <section>
              <SectionHeading>Om fellesskapet</SectionHeading>
              <Panel className="p-5 sm:p-6">
                <RichText body={community.about} />
              </Panel>
            </section>

            {pinned ? (
              <section>
                <SectionHeading
                  action={
                    <Link
                      href={`/community/${community.id}/feed`}
                      className="inline-flex items-center gap-1 text-xs text-ink-2 transition-colors hover:text-ink"
                    >
                      Åpne feeden
                      <IconArrowRight size={13} />
                    </Link>
                  }
                >
                  Festet kunngjøring
                </SectionHeading>
                <PostCard
                  post={pinned}
                  author={people.get(pinned.authorId)!}
                  community={community}
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
                    Hele feeden
                    <IconArrowRight size={13} />
                  </Link>
                }
              >
                Siste aktivitet
              </SectionHeading>
              <div className="space-y-4">
                {feed.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    author={people.get(post.authorId)!}
                    community={community}
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
                    Alle
                  </Link>
                }
              >
                Neste arrangementer
              </SectionHeading>
              {events.length === 0 ? (
                <p className="text-sm text-ink-3">Ingenting planlagt akkurat nå.</p>
              ) : (
                <div className="space-y-3">
                  {events.map((event) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      community={community}
                      host={people.get(event.hostId)}
                      attending={event.attendeeIds.includes(user.id)}
                      variant="compact"
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionHeading>Kanaler</SectionHeading>
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
                              {timeAgo(latestAt)}
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

            {/*
              Only shown when the membership is readable. Where the registry is
              admin-only this comes back empty from the database, and an empty
              "Kontaktpersoner" panel reads as a fault rather than a setting.
            */}
            {leaders.length > 0 ? (
              <section>
              <SectionHeading
                action={
                  <Link
                    href={`/community/${community.id}/members`}
                    className="text-xs text-ink-2 transition-colors hover:text-ink"
                  >
                    Alle
                  </Link>
                }
              >
                Kontaktpersoner
              </SectionHeading>
              <Panel className="divide-y divide-line">
                {leaders.map(({ persona: person, membership: personMembership }) => (
                  <div key={person.id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar user={person} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {person.name}
                      </span>
                      {publicMemberTitle(personMembership.title) ? (
                        <span className="block truncate text-[11px] text-ink-3">
                          {publicMemberTitle(personMembership.title)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </Panel>
              </section>
            ) : null}

            <p
              className={cn(
                "flex items-start gap-2 rounded-[6px] border border-line px-4 py-3 text-[11px] leading-relaxed text-ink-3",
              )}
            >
              <IconLock size={13} className="mt-px shrink-0" />
              Innholdet her er kun synlig for medlemmer. Den offentlige siden på {PUBLIC_HOST}/
              {community.slug} viser bare det {community.name} selv velger å dele.
            </p>
          </aside>
        </div>
      </PageContainer>
    </>
  );
}
