import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  ButtonLink,
  CommunityMark,
  EmptyState,
  Panel,
  PageContainer,
  PageHeader,
  RoleBadge,
  SectionHeading,
} from "@/components/ui/primitives";
import { IconArrowRight, IconLock, IconMail, IconUsers } from "@/components/ui/icons";
import {
  getCommunitiesForUser,
  getCommunityEvents,
  getInvitationsForUser,
  getPendingRequestsForUser,
  getUpcomingCommunityEvents,
  getUsers,
} from "@/lib/data";
import { formatFullDate, plural } from "@/lib/format";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Mine fellesskap" };

export default async function CommunitiesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [communities, invitations, requests] = await Promise.all([
    getCommunitiesForUser(user.id),
    getInvitationsForUser(user.id),
    getPendingRequestsForUser(user.id),
  ]);

  const inviters = new Map(
    (
      await getUsers([
        ...new Set(
          invitations
            .map((entry) => entry.membership.invitedBy)
            .filter((id): id is string => Boolean(id)),
        ),
      ])
    ).map((u) => [u.id, u]),
  );

  // Event counts per community, resolved before rendering the cards.
  const eventCounts = new Map(
    await Promise.all(
      communities.map(async ({ community }) => {
        const [upcoming, all] = await Promise.all([
          getUpcomingCommunityEvents(community.id),
          getCommunityEvents(community.id),
        ]);
        return [community.id, { upcoming: upcoming.length, total: all.length }] as const;
      }),
    ),
  );

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Mine fellesskap"
        title="Fellesskapene dine"
        lead="Én konto, flere organisasjoner. Denne listen inneholder kun det du selv har tilgang til — Vev har ingen katalog over andre fellesskap."
      />

      {invitations.length > 0 || requests.length > 0 ? (
        <section className="mb-10">
          <SectionHeading>Under behandling</SectionHeading>
          <div className="space-y-3">
            {invitations.map(({ community, membership }) => {
              const inviter = membership.invitedBy
                ? inviters.get(membership.invitedBy)
                : undefined;
              return (
                <Panel
                  key={community.id}
                  className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"
                >
                  <CommunityMark community={community} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-medium text-ink">
                      {community.name}
                      <Badge tone="rust">
                        <IconMail size={11} />
                        Invitasjon
                      </Badge>
                    </p>
                    <p className="mt-1 text-sm text-ink-2">
                      {inviter ? `Invitert av ${inviter.name}, ` : ""}
                      {formatFullDate(membership.joinedAt)}
                    </p>
                  </div>
                  <ButtonLink href={`/${community.slug}`} size="sm" className="shrink-0">
                    Se invitasjonen
                  </ButtonLink>
                </Panel>
              );
            })}

            {requests.map(({ community, membership }) => (
              <Panel
                key={community.id}
                className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"
              >
                <CommunityMark community={community} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-medium text-ink">
                    {community.name}
                    <Badge tone="neutral">Venter på svar</Badge>
                  </p>
                  <p className="mt-1 text-sm text-ink-2">
                    Du ba om tilgang {formatFullDate(membership.joinedAt)}. En administrator ser
                    på forespørselen.
                  </p>
                </div>
              </Panel>
            ))}
          </div>
        </section>
      ) : null}

      {communities.length === 0 ? (
        <EmptyState
          title="Du er ikke medlem av noe fellesskap"
          body="Slik er Vev bygget: det finnes ingen oversikt over hvilke organisasjoner som bruker plattformen. Du kommer inn på tre måter — du blir invitert av noen som allerede er medlem, du får en direktelenke til organisasjonens egen portal, eller du ber om tilgang der."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {communities.map(({ community, membership }) => {
            const counts = eventCounts.get(community.id) ?? { upcoming: 0, total: 0 };
            return (
              <Panel as="li" key={community.id} className="flex flex-col p-5">
                <div className="flex items-start gap-3.5">
                  <CommunityMark community={community} size="md" />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-lg leading-tight text-ink">
                      {community.name}
                    </h2>
                    <p className="mt-1 text-[13px] text-ink-3">{community.tagline}</p>
                  </div>
                </div>

                <p className="mt-4 flex-1 text-sm leading-relaxed text-ink-2">
                  {community.about.split(". ").slice(0, 2).join(". ")}.
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <RoleBadge role={membership.role} />
                  {membership.title ? <Badge tone="outline">{membership.title}</Badge> : null}
                </div>

                <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3.5 text-xs text-ink-3">
                  <div className="flex items-center gap-1.5">
                    <dt className="sr-only">Medlemmer</dt>
                    <IconUsers size={13} />
                    <dd>{plural(community.memberCount, "medlem", "medlemmer")}</dd>
                  </div>
                  <div>
                    <dt className="sr-only">Arrangementer</dt>
                    <dd>
                      {counts.upcoming > 0
                        ? plural(counts.upcoming, "kommende arrangement", "kommende arrangementer")
                        : `${counts.total} arrangementer i arkivet`}
                    </dd>
                  </div>
                </dl>

                <Link
                  href={`/community/${community.id}`}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-70"
                  style={{ color: community.branding.accent }}
                >
                  Åpne fellesskapet
                  <IconArrowRight size={15} />
                </Link>
              </Panel>
            );
          })}
        </ul>
      )}

      <Panel className="mt-10 flex flex-col gap-4 bg-skog-soft/50 p-5 sm:flex-row sm:items-start">
        <IconLock size={20} className="mt-0.5 shrink-0 text-skog" />
        <div>
          <h2 className="text-[0.9375rem] font-medium text-ink">
            Hvorfor finnes det ingen «utforsk»-side?
          </h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">
            Mange organisasjoner arbeider med noe som gjør medlemslister sensitive — helse,
            rusfeltet, aktivisme, varsling. Et globalt register over hvilke fellesskap som finnes
            på plattformen ville i praksis vært et register over hvem som er engasjert i hva. Derfor
            har vi ikke laget ett. Hver organisasjon bestemmer selv hvem som får vite at de er her.
          </p>
        </div>
      </Panel>
    </PageContainer>
  );
}
