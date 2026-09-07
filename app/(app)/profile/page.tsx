import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions";
import {
  Avatar,
  Button,
  ButtonLink,
  CommunityMark,
  Panel,
  PageContainer,
  PageHeader,
  RoleBadge,
  SectionHeading,
} from "@/components/ui/primitives";
import { IconLock, IconMapPin, IconShield, IconSwitch } from "@/components/ui/icons";
import { getCommunitiesForUser, getEventsForUser } from "@/lib/data";
import { formatFullDate, plural } from "@/lib/format";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Profil" };

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [communities, events] = await Promise.all([
    getCommunitiesForUser(user.id),
    getEventsForUser(user.id),
  ]);

  return (
    <PageContainer>
      <PageHeader eyebrow="Profil" title="Kontoen din" />

      <Panel className="p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <Avatar user={user} size="xl" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl leading-tight text-ink">{user.name}</h2>
            <p className="mt-1 text-sm text-ink-3">
              @{user.handle} · {user.pronoun}
            </p>
            <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">{user.bio}</p>
            <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-2">
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Sted</dt>
                <IconMapPin size={14} className="text-ink-3" />
                <dd>{user.location}</dd>
              </div>
              <div>
                <dt className="sr-only">Medlem siden</dt>
                <dd>Konto på Vev siden {formatFullDate(user.joinedAt)}</dd>
              </div>
            </dl>
          </div>
          <Button variant="secondary" size="sm" className="shrink-0" disabled>
            Rediger profil
          </Button>
        </div>
      </Panel>

      <section className="mt-10">
        <SectionHeading>Én profil, ulike roller</SectionHeading>
        {communities.length === 0 ? (
          <Panel className="p-5">
            <p className="text-sm leading-relaxed text-ink-2">
              Du har ingen medlemskap ennå. Profilen din er ikke synlig for noen før du blir med i
              et fellesskap, og den vises da kun for medlemmene der.
            </p>
          </Panel>
        ) : (
          <Panel className="divide-y divide-line">
            {communities.map(({ community, membership }) => (
              <Link
                key={community.id}
                href={`/community/${community.id}/members`}
                className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-paper-2/60"
              >
                <CommunityMark community={community} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem] font-medium text-ink">
                    {community.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-ink-3">
                    {membership.title ?? "Medlem"} · siden {formatFullDate(membership.joinedAt)}
                  </span>
                </span>
                <RoleBadge role={membership.role} />
              </Link>
            ))}
          </Panel>
        )}
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          Du har én konto, men opptrer med ulik rolle i hvert fellesskap. Medlemmer i ett fellesskap
          ser ikke hvilke andre fellesskap du er med i.
        </p>
      </section>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Panel className="p-5">
          <SectionHeading>Aktivitet</SectionHeading>
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Fellesskap</dt>
              <dd className="font-medium text-ink">{communities.length}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Kommende arrangementer</dt>
              <dd className="font-medium text-ink">{events.length}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Påmeldt</dt>
              <dd className="font-medium text-ink">
                {plural(
                  events.filter((event) => event.attendeeIds.includes(user.id)).length,
                  "arrangement",
                  "arrangementer",
                )}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel className="p-5">
          <SectionHeading>Personvern</SectionHeading>
          <ul className="space-y-2.5 text-[13px] leading-relaxed text-ink-2">
            <li className="flex gap-2.5">
              <IconLock size={15} className="mt-0.5 shrink-0 text-skog" />
              Profilen din vises bare for medlemmer i fellesskap du selv er med i.
            </li>
            <li className="flex gap-2.5">
              <IconShield size={15} className="mt-0.5 shrink-0 text-skog" />
              Vev har ingen offentlig søkefunksjon for personer eller organisasjoner.
            </li>
          </ul>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-3">
            Ende-til-ende-kryptert meldingsutveksling er planlagt, men ikke slått på i denne
            prototypen.
          </p>
        </Panel>
      </div>

      <div className="mt-10 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-ink">Innlogget som {user.email}</p>
          <p className="mt-0.5 text-xs text-ink-3">
            Denne prototypen bruker demokontoer uten passord.
          </p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href="/login" variant="secondary" size="sm">
            <IconSwitch size={15} />
            Bytt konto
          </ButtonLink>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">
              Logg ut
            </Button>
          </form>
        </div>
      </div>
    </PageContainer>
  );
}
