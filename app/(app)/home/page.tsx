import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EventCard } from "@/components/community/EventCard";
import { PostCard } from "@/components/community/PostCard";
import {
  ButtonLink,
  CommunityMark,
  ElevatedRoleBadge,
  EmptyState,
  Panel,
  PageContainer,
  PageHeader,
  SectionHeading,
} from "@/components/ui/primitives";
import { IconArrowRight, IconLock } from "@/components/ui/icons";
import {
  getCommunitiesForUser,
  getEventsForUser,
  getHomeFeed,
  getLatestMessage,
  getGroupedChannels,
  getCommunityById,
  getUser,
  getUsers,
} from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { publicMemberTitle } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";
import { PUBLIC_HOST } from "@/lib/brand";

export const metadata: Metadata = { title: "Hjem" };

function greeting(name: string) {
  return `God ettermiddag, ${name.split(" ")[0]}`;
}

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [communities, feed, allEvents] = await Promise.all([
    getCommunitiesForUser(user.id),
    getHomeFeed(user.id, 6),
    getEventsForUser(user.id),
  ]);
  const events = allEvents.slice(0, 3);

  // Everything the JSX needs is resolved here — a component tree cannot await.
  const communityById = new Map(communities.map(({ community }) => [community.id, community]));
  for (const id of [...feed.map((p) => p.communityId), ...events.map((e) => e.communityId)]) {
    if (!communityById.has(id)) {
      const community = await getCommunityById(id);
      if (community) communityById.set(id, community);
    }
  }

  const people = new Map(
    (
      await getUsers([
        ...new Set([
          ...feed.map((post) => post.authorId),
          ...events.map((event) => event.hostId),
        ]),
      ])
    ).map((person) => [person.id, person]),
  );

  // The two most recently used channels per community, with their last message.
  const activeChannels = (
    await Promise.all(
      communities.map(async ({ community }) => {
        const groups = await getGroupedChannels(community.id);
        const channels = groups.flatMap((group) => group.channels).slice(0, 2);
        return Promise.all(
          channels.map(async (channel) => {
            const latest = await getLatestMessage(channel.id);
            if (!latest) return null;
            const author = await getUser(latest.authorId);
            return { community, channel, latest, authorName: author?.name.split(" ")[0] };
          }),
        );
      }),
    )
  )
    .flat()
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return (
    <PageContainer width="wide">
      <PageHeader
        eyebrow="Hjem"
        title={greeting(user.name)}
        lead={
          communities.length === 0
            ? "Kontoen din er klar. Fellesskap på TING er lukkede — du kommer inn gjennom en invitasjon eller en direktelenke fra organisasjonen selv."
            : `Du er med i ${communities.length} ${
                communities.length === 1 ? "fellesskap" : "fellesskap"
              }. Her er det som har skjedd siden sist.`
        }
      />

      {communities.length === 0 ? (
        <EmptyState
          title="Ingen fellesskap ennå"
          body={`TING har ingen katalog du kan bla i, og det er med vilje. Organisasjoner deler sin egen portal-lenke med dem de vil ha inn — for eksempel ${PUBLIC_HOST}/tryggere-ruspolitikk. Har du fått en lenke eller en invitasjon på e-post, er det der du starter.`}
          action={
            <ButtonLink href="/communities" variant="secondary">
              Les mer om hvordan tilgang fungerer
            </ButtonLink>
          }
        />
      ) : (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-12">
          <div>
            <SectionHeading
              action={
                <Link
                  href="/communities"
                  className="inline-flex items-center gap-1 text-xs text-ink-2 transition-colors hover:text-ink"
                >
                  Alle fellesskap
                  <IconArrowRight size={13} />
                </Link>
              }
            >
              Siste fra fellesskapene dine
            </SectionHeading>
            <div className="space-y-4">
              {feed.map((post) => {
                const community = communityById.get(post.communityId)!;
                const author = people.get(post.authorId)!;
                return (
                  <PostCard
                    key={post.id}
                    post={post}
                    author={author}
                    community={community}
                    showCommunity
                  />
                );
              })}
            </div>
          </div>

          <aside className="space-y-10">
            <section>
              <SectionHeading>Neste på programmet</SectionHeading>
              {events.length === 0 ? (
                <p className="text-sm text-ink-3">Ingenting på kalenderen akkurat nå.</p>
              ) : (
                <div className="space-y-3">
                  {events.map((event) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      community={communityById.get(event.communityId)!}
                      host={people.get(event.hostId)}
                      attending={event.attendeeIds.includes(user.id)}
                      variant="compact"
                      showCommunity
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionHeading>Aktive kanaler</SectionHeading>
              <Panel className="divide-y divide-line">
                {activeChannels.map(({ community, channel, latest, authorName }) => (
                  <Link
                    key={channel.id}
                    href={`/community/${community.id}/channel/${channel.id}`}
                    className="block px-4 py-3 transition-colors hover:bg-paper-2/60"
                  >
                    <span className="flex items-center gap-2">
                      <CommunityMark
                        community={community}
                        size="xs"
                        className="h-4 w-4 text-[7px]"
                      />
                      <span className="truncate text-[13px] font-medium text-ink">
                        #{channel.name}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-ink-3">
                        {timeAgo(latest.createdAt)}
                      </span>
                    </span>
                    <span className="mt-1 line-clamp-2 block text-[13px] leading-relaxed text-ink-2">
                      {authorName}: {latest.body}
                    </span>
                  </Link>
                ))}
              </Panel>
            </section>

            <section>
              <SectionHeading>Rollene dine</SectionHeading>
              <Panel className="divide-y divide-line">
                {communities.map(({ community, membership }) => (
                  <Link
                    key={community.id}
                    href={`/community/${community.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-paper-2/60"
                  >
                    <CommunityMark community={community} size="xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {community.name}
                      </span>
                      {publicMemberTitle(membership.title) ? (
                        <span className="block truncate text-[11px] text-ink-3">
                          {publicMemberTitle(membership.title)}
                        </span>
                      ) : null}
                    </span>
                    <ElevatedRoleBadge role={membership.role} />
                  </Link>
                ))}
              </Panel>
              <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-ink-3">
                <IconLock size={13} className="mt-px shrink-0" />
                Fellesskapene dine er ikke synlige for andre, og de kan ikke søkes opp på TING.
              </p>
            </section>
          </aside>
        </div>
      )}
    </PageContainer>
  );
}
