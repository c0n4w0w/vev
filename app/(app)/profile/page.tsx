import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions";
import {
  Avatar,
  Button,
  ButtonLink,
  ElevatedRoleBadge,
  Panel,
  PageContainer,
  PageHeader,
  SectionHeading,
} from "@/components/ui/primitives";
import { CommunityAvatar } from "@/components/ui/CommunityAvatar";
import { IconLock, IconShield, IconSwitch } from "@/components/ui/icons";
import { getCommunitiesForUser, getEventsForUser, getMyCommunityPersonas } from "@/lib/data";
import { formatFullDate, plural } from "@/lib/format";
import { publicMemberTitle } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Profil" };

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [communities, events, personas] = await Promise.all([
    getCommunitiesForUser(user.id),
    getEventsForUser(user.id),
    getMyCommunityPersonas(user.id),
  ]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Profil"
        title="Kontoen din"
        lead="Én TING-konto, og en egen profil i hvert fellesskap du er med i."
      />

      {/* The account: what signs in, not what anyone else sees. */}
      <Panel className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar user={user} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-xl leading-tight text-ink">{user.name}</h2>
            <p className="mt-1 truncate text-sm text-ink-3">@{user.handle}</p>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[13px] text-ink-2">
              <div className="min-w-0">
                <dt className="sr-only">E-post</dt>
                <dd className="truncate">{user.email}</dd>
              </div>
              <div>
                <dt className="sr-only">Konto opprettet</dt>
                <dd>Konto på TING siden {formatFullDate(user.joinedAt)}</dd>
              </div>
            </dl>
          </div>
        </div>
        <p className="mt-4 flex items-start gap-2 border-t border-line pt-4 text-xs leading-relaxed text-ink-3">
          <IconLock size={13} className="mt-px shrink-0" />
          Kontoen er bare synlig for deg. Andre ser deg gjennom profilen du har i fellesskapet dere
          deler.
        </p>
      </Panel>

      <section className="mt-10">
        <SectionHeading>Én konto, ulike profiler</SectionHeading>
        {communities.length === 0 ? (
          <Panel className="p-5">
            <p className="text-sm leading-relaxed text-ink-2">
              Du har ingen medlemskap ennå. Når du blir med i et fellesskap, får du en egen profil der
              — med navnet du oppga da du ba om tilgang.
            </p>
          </Panel>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {communities.map(({ community, membership }) => {
              const persona = personas.get(community.id);
              const title = publicMemberTitle(membership.title);
              return (
                <Panel as="li" key={community.id} className="flex flex-col">
                  <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                    <CommunityAvatar community={community} size="xs" />
                    <Link
                      href={`/community/${community.id}`}
                      className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink hover:underline"
                    >
                      {community.name}
                    </Link>
                    <ElevatedRoleBadge role={membership.role} />
                  </div>
                  <div className="flex flex-1 gap-3.5 px-4 py-4">
                    {persona ? <Avatar user={persona} size="lg" /> : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.9375rem] font-medium text-ink">
                        {persona?.name ?? "Profilen er ikke satt opp"}
                      </p>
                      {title ? (
                        <p className="mt-0.5 truncate text-[13px] text-ink-2">{title}</p>
                      ) : null}
                      <p
                        className={
                          persona?.bio
                            ? "mt-2 line-clamp-3 text-[13px] leading-relaxed text-ink-2"
                            : "mt-2 text-[13px] leading-relaxed text-ink-3"
                        }
                      >
                        {persona?.bio || "Ingen bio her ennå."}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-4 pb-4">
                    <span className="text-[11px] text-ink-3">
                      Medlem siden {formatFullDate(membership.joinedAt)}
                    </span>
                    <ButtonLink
                      href={`/community/${community.id}/profile/edit`}
                      variant="secondary"
                      size="sm"
                      aria-label={`Rediger profil i ${community.name}`}
                    >
                      Rediger profil
                    </ButtonLink>
                  </div>
                </Panel>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          Hvert fellesskap ser bare profilen du har der. Navn, bilde og bio fra ett fellesskap vises
          aldri i et annet, og medlemmer ser ikke hvilke andre fellesskap du er med i.
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
              Hver profil vises bare for medlemmer av det fellesskapet den hører til.
            </li>
            <li className="flex gap-2.5">
              <IconShield size={15} className="mt-0.5 shrink-0 text-skog" />
              TING har ingen offentlig søkefunksjon for personer eller organisasjoner.
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
