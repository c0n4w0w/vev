import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventCard } from "@/components/community/EventCard";
import { LocalGroupAdmin } from "@/components/community/LocalGroupAdmin";
import { LocalGroupPicker } from "@/components/community/LocalGroupPicker";
import { OrganizationPersonCard } from "@/components/community/OrganizationPersonCard";
import {
  EmptyState,
  PageContainer,
  PageHeader,
  Panel,
  SectionHeading,
  buttonClass,
} from "@/components/ui/primitives";
import { IconArrowRight, IconMapPin } from "@/components/ui/icons";
import {
  getCommunityById,
  getLocalGroupLeader,
  getLocalGroupMemberCounts,
  getLocalGroups,
  getMembership,
  getRecentLocalGroupPosts,
  getUpcomingLocalGroupEvents,
  getUsers,
} from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import type { Community, Post, User } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/lokallag">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  return { title: `Mitt lokallag · ${community?.name ?? "Fellesskap"}` };
}

function excerpt(body: string) {
  const first = body.replace(/\s+/g, " ").trim();
  return first.length > 180 ? `${first.slice(0, 177)}...` : first;
}

function LocalPostPreview({
  post,
  author,
  community,
}: {
  post: Post;
  author?: User;
  community: Community;
}) {
  return (
    <Panel as="li" className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[12px] text-ink-3">
            {author?.name ?? "Medlem"} · {timeAgo(post.createdAt)}
          </p>
          <h3 className="mt-1 font-display text-[1rem] leading-snug text-ink">
            <Link href={`/community/${community.id}/feed#post-${post.id}`} className="hover:text-ink-2">
              {post.title ?? excerpt(post.body)}
            </Link>
          </h3>
          {post.title ? (
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{excerpt(post.body)}</p>
          ) : null}
        </div>
        <Link
          href={`/community/${community.id}/feed#post-${post.id}`}
          className="mt-1 shrink-0 text-ink-3 transition-colors hover:text-ink"
          aria-label="Åpne innlegg"
        >
          <IconArrowRight size={16} />
        </Link>
      </div>
    </Panel>
  );
}

/**
 * Local groups: the member's own affiliation, and — for administrators — the
 * roster of groups itself.
 *
 * Reachable directly after accepting an invitation, and from the sidebar at
 * any time afterwards. Nothing here is required: a member who never opens this
 * page has full access to everything, which is the point.
 */
export default async function LocalGroupsPage({
  params,
  searchParams,
}: PageProps<"/community/[communityId]/lokallag">) {
  const { communityId } = await params;
  const { velkommen } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();

  const [membership, groups, memberCounts] = await Promise.all([
    getMembership(user.id, community.id),
    getLocalGroups(community.id),
    getLocalGroupMemberCounts(community.id),
  ]);

  // A community that has never defined any. The feature simply does not apply
  // here — no slug is consulted to reach that conclusion.
  if (groups.length === 0) {
    return (
      <PageContainer>
        <PageHeader eyebrow={community.name} title="Lokallag" />
        <EmptyState
          title="Dette fellesskapet bruker ikke lokallag"
          body={`${community.name} har ikke opprettet lokallag. Du er medlem av fellesskapet som helhet.`}
        />
      </PageContainer>
    );
  }

  const isAdmin = membership?.role === "admin";
  const selected = groups.find((group) => group.id === membership?.localGroupId);
  const selectable = groups.filter((group) => group.active);
  const welcome = velkommen === "1";
  const [localEvents, localPosts] = selected
    ? await Promise.all([
        getUpcomingLocalGroupEvents(community.id, selected.id, 3),
        getRecentLocalGroupPosts(community.id, selected.id, 3),
      ])
    : [[], []];
  const localLeader = selected
    ? await getLocalGroupLeader(community.id, selected.id)
    : undefined;
  const localPeople = new Map(
    selected
      ? (
          await getUsers([
            ...new Set([
              ...localPosts.map((post) => post.authorId),
              ...localEvents.map((event) => event.hostId),
            ]),
          ])
        ).map((u) => [u.id, u])
      : [],
  );

  return (
    <PageContainer>
      <PageHeader
        eyebrow={community.name}
        title="Mitt lokallag"
        lead={
          selected
            ? `Lokale aktiviteter og innlegg fra lokallaget ditt i ${community.name}.`
            : welcome
              ? `Du er nå medlem av ${community.name}. Hvis du er tilknyttet et lokallag, kan du velge det her.`
              : `Velg et lokallag for å få fram aktivitet som er mest relevant for deg.`
        }
      />

      {selected ? (
        <>
          <section className="mb-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px]"
                  style={{ backgroundColor: `${community.branding.accent}12`, color: community.branding.accent }}
                >
                  <IconMapPin size={19} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] text-ink-3">Du er tilknyttet</p>
                  <h2 className="font-display text-2xl leading-tight text-ink">{selected.name}</h2>
                  {selected.active ? null : (
                    <p className="mt-1 text-[12px] text-ink-3">
                      Dette lokallaget er avviklet. Du beholder tilknytningen, men den kan ikke
                      velges på nytt.
                    </p>
                  )}
                </div>
              </div>
              <a href="#endre-lokallag" className={buttonClass({ variant: "secondary", size: "sm" })}>
                Endre lokallag
              </a>
            </div>

            <SectionHeading
              action={
                localEvents.length > 1 ? (
                  <Link href={`/community/${community.id}/events`} className="text-xs text-ink-3 hover:text-ink">
                    Alle arrangementer
                  </Link>
                ) : null
              }
            >
              Neste aktivitet
            </SectionHeading>
            {localEvents.length > 0 ? (
              <div className="space-y-3">
                {localEvents.map((event, index) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    community={community}
                    host={localPeople.get(event.hostId)}
                    attending={event.attendeeIds.includes(user.id)}
                    variant={index === 0 ? "full" : "compact"}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="Ingen lokale arrangementer akkurat nå"
                body="Det er ingen lokale arrangementer planlagt for dette lokallaget ennå."
              />
            )}
          </section>

          <section className="mb-10">
            <SectionHeading
              action={
                localPosts.length > 0 ? (
                  <Link href={`/community/${community.id}/feed`} className="text-xs text-ink-3 hover:text-ink">
                    Åpne feed
                  </Link>
                ) : null
              }
            >
              Fra lokallaget
            </SectionHeading>
            {localPosts.length > 0 ? (
              <ul className="space-y-3">
                {localPosts.map((post) => (
                  <LocalPostPreview
                    key={post.id}
                    post={post}
                    author={localPeople.get(post.authorId)}
                    community={community}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                title="Ingen innlegg fra lokallaget ennå"
                body="Når noen publiserer et innlegg med dette lokallaget som område, vises det her."
              />
            )}
          </section>

          {localLeader ? (
            <section className="mb-10">
              <SectionHeading>Kontakt</SectionHeading>
              <ul className="max-w-xl">
                <OrganizationPersonCard person={localLeader} localGroupName={selected.name} compact />
              </ul>
            </section>
          ) : null}

          <details id="endre-lokallag" className="mb-8 rounded-[6px] border border-line bg-surface p-5">
            <summary className="cursor-pointer text-sm font-medium text-ink">Endre lokallag</summary>
            <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-ink-3">
              Du kan bytte lokallag eller fjerne valget. Det påvirker ikke medlemskapet ditt i{" "}
              {community.name}.
            </p>
            <div className="mt-4">
              <LocalGroupPicker
                communityId={community.id}
                groups={selectable}
                selectedId={selected.active ? selected.id : undefined}
                accent={community.branding.accent}
                memberCounts={memberCounts}
                welcome={welcome}
              />
            </div>
          </details>
        </>
      ) : (
        <>
          <EmptyState
            title="Du har ikke valgt et lokallag ennå."
            body={`Å velge lokallag gjør det lettere å se lokal aktivitet i ${community.name}. Det er helt valgfritt, og du er medlem av fellesskapet uansett.`}
            action={
              <a href="#velg-lokallag" className={buttonClass({ variant: "primary", size: "md" })}>
                Velg lokallag
              </a>
            }
          />

          <section id="velg-lokallag" className="mt-8 scroll-mt-6">
            <SectionHeading>Velg lokallag</SectionHeading>
            <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-ink-3">
              Velg lokallaget du er tilknyttet. Hører du ikke til noe lokallag, lar du det stå tomt
              — det påvirker ikke medlemskapet ditt i {community.name}.
            </p>
            <LocalGroupPicker
              communityId={community.id}
              groups={selectable}
              accent={community.branding.accent}
              memberCounts={memberCounts}
              welcome={welcome}
            />
          </section>
        </>
      )}

      {isAdmin ? (
        <div className="mt-12 border-t border-line pt-8">
          <SectionHeading>Administrer lokallag</SectionHeading>
          <p className="-mt-2 mb-4 max-w-2xl text-[13px] leading-relaxed text-ink-3">
            Som administrator i {community.name} bestemmer du hvilke lokallag medlemmene kan velge
            mellom.
          </p>
          <LocalGroupAdmin
            communityId={community.id}
            groups={groups}
            memberCounts={memberCounts}
          />
        </div>
      ) : null}
    </PageContainer>
  );
}
