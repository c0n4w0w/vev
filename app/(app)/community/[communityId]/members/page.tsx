import { notFound, redirect } from "next/navigation";
import { startDirectConversationAction } from "@/app/actions";
import { OrganizationPersonCard } from "@/components/community/OrganizationPersonCard";
import {
  Avatar,
  Badge,
  ButtonLink,
  EmptyState,
  PageContainer,
  PageHeader,
  Panel,
  SectionHeading,
  buttonClass,
} from "@/components/ui/primitives";
import { IconLock, IconMapPin, IconShield } from "@/components/ui/icons";
import {
  canViewMemberDirectory,
  type CommunityMember,
  getCommunityById,
  getCommunityMembers,
  getCommunityPeople,
  getMemberDmActions,
  getMembership,
  getOrganizationPersonDmActions,
  getRole,
} from "@/lib/data";
import { formatFullDate, plural } from "@/lib/format";
import { getSessionUser } from "@/lib/session";
import type { CommunityPerson, CommunityPersonSection, RoleId } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/members">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  const people = community ? await getCommunityPeople(community.id) : [];
  return { title: `${people.length > 0 ? "Organisasjonen" : "Medlemmer"} · ${community?.name ?? "Fellesskap"}` };
}

const roleOrder: RoleId[] = ["admin", "moderator", "member"];
const organizationSections: { id: CommunityPersonSection; title: string }[] = [
  { id: "staff", title: "Ansatte" },
  { id: "board", title: "Sentralstyret" },
  { id: "local_group_leader", title: "Lokallagsledere" },
];

function GeneralContactBlock({ email }: { email: string }) {
  return (
    <Panel className="mb-8 flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
          Generell kontakt
        </p>
        <p className="mt-1 text-[13px] text-ink-2">
          For spørsmål som ikke gjelder én bestemt person.
        </p>
      </div>
      <a href={`mailto:${email}`} className="text-[13px] font-medium text-fjord hover:text-ink">
        {email}
      </a>
    </Panel>
  );
}

function OrganizationRows({
  title,
  people,
  communityId,
  dmActions,
  leaders = false,
}: {
  title: string;
  people: CommunityPerson[];
  communityId: string;
  dmActions: Map<string, string | undefined>;
  leaders?: boolean;
}) {
  if (people.length === 0) return null;

  return (
    <section>
      <SectionHeading>{title}</SectionHeading>
      <ul className="grid gap-3 sm:grid-cols-2">
        {people.map((person) => (
          <OrganizationPersonCard
            key={person.id}
            person={person}
            localGroupName={leaders ? person.localGroupName : undefined}
            dmAction={
              dmActions.has(person.id)
                ? { communityId, conversationId: dmActions.get(person.id) }
                : undefined
            }
          />
        ))}
      </ul>
    </section>
  );
}

function MemberDirectory({
  members,
  userId,
  communityId,
  dmActions,
}: {
  members: CommunityMember[];
  userId: string;
  communityId: string;
  dmActions: Map<string, string | undefined>;
}) {
  return (
    <div className="space-y-10">
      {roleOrder.map((roleId) => {
        const group = members.filter((entry) => entry.membership.role === roleId);
        if (group.length === 0) return null;
        const role = getRole(roleId);

        return (
          <section key={roleId}>
            <SectionHeading>
              {role.label} · {group.length}
            </SectionHeading>
            <p className="-mt-2 mb-4 text-[13px] text-ink-3">{role.description}</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {group.map(({ user: person, membership: personMembership }) => (
                <Panel as="li" key={person.id} className="flex gap-3.5 p-4">
                  <Avatar user={person} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[0.9375rem] font-medium text-ink">
                        {person.name}
                      </span>
                      {person.id === userId ? <Badge tone="skog">Deg</Badge> : null}
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink-2">
                      {personMembership.title ?? role.label}
                    </p>
                    <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-3">
                      {person.bio}
                    </p>
                    <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
                      <span className="inline-flex items-center gap-1">
                        <IconMapPin size={12} />
                        {person.location}
                      </span>
                      <span>Medlem siden {formatFullDate(personMembership.joinedAt)}</span>
                    </p>
                    {dmActions.has(person.id) ? (
                      <div className="mt-3">
                        {dmActions.get(person.id) ? (
                          <ButtonLink
                            href={`/community/${communityId}/messages/${dmActions.get(person.id)}`}
                            size="sm"
                            variant="secondary"
                          >
                            Send melding
                          </ButtonLink>
                        ) : (
                          <form action={startDirectConversationAction}>
                            <input type="hidden" name="communityId" value={communityId} />
                            <input type="hidden" name="recipientId" value={person.id} />
                            <button
                              type="submit"
                              className={buttonClass({ variant: "secondary", size: "sm" })}
                            >
                              Send melding
                            </button>
                          </form>
                        )}
                      </div>
                    ) : null}
                  </div>
                </Panel>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export default async function MembersPage({
  params,
}: PageProps<"/community/[communityId]/members">) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();

  const [membership, canViewDirectory, organizationPeople] = await Promise.all([
    getMembership(user.id, community.id),
    canViewMemberDirectory(community.id),
    getCommunityPeople(community.id),
  ]);
  const isAdmin = membership?.role === "admin";

  if (organizationPeople.length > 0) {
    const [members, organizationDmActions, memberDmActions] = await Promise.all([
      canViewDirectory ? getCommunityMembers(community.id) : Promise.resolve([]),
      getOrganizationPersonDmActions(community.id),
      canViewDirectory ? getMemberDmActions(community.id) : Promise.resolve(new Map()),
    ]);

    return (
      <PageContainer>
        <PageHeader
          eyebrow={community.name}
          title="Organisasjonen"
          lead="Offentlig kontaktinformasjon fra organisasjonen. Dette er ikke medlemslisten i TING."
          action={
            isAdmin ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <ButtonLink
                  href={`/community/${community.id}/organization-links`}
                  size="sm"
                  variant="secondary"
                >
                  Administrer kontokoblinger
                </ButtonLink>
                <ButtonLink
                  href={`/community/${community.id}/requests`}
                  size="sm"
                  variant="secondary"
                  className="sm:order-first"
                >
                  Medlemsforespørsler
                </ButtonLink>
              </div>
            ) : undefined
          }
        />

        {community.id === "tryggere-ungdom" ? (
          <GeneralContactBlock email="tryggereungdom@gmail.com" />
        ) : null}

        <div className="space-y-10">
          {organizationSections.map((section) => {
            const people = organizationPeople.filter((person) => person.section === section.id);
            return (
              <OrganizationRows
                key={section.id}
                title={section.title}
                people={people}
                communityId={community.id}
                dmActions={organizationDmActions}
                leaders={section.id === "local_group_leader"}
              />
            );
          })}
        </div>

        {isAdmin && canViewDirectory ? (
          <section className="mt-12 border-t border-line pt-8">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-2xl">
                <p className="label mb-2">Kun for administratorer</p>
                <h2 className="font-display text-2xl leading-tight text-ink">
                  Medlemsadministrasjon
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
                  Som administrator i {community.name} kan du se den private medlemslisten,
                  invitere nye medlemmer, behandle forespørsler og endre roller.
                </p>
              </div>
              <div className="shrink-0">
                <ButtonLink href={`/community/${community.id}/requests`} size="sm" variant="secondary">
                  Medlemsforespørsler
                </ButtonLink>
              </div>
            </div>
            <MemberDirectory
              members={members}
              userId={user.id}
              communityId={community.id}
              dmActions={memberDmActions}
            />
          </section>
        ) : (
          <Panel className="mt-10 flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
            <IconLock size={20} className="mt-0.5 shrink-0 text-skog" />
            <p className="max-w-2xl text-[13px] leading-relaxed text-ink-2">
              Medlemslisten i {community.name} er privat. Organisasjonsoversikten her er en
              separat, offentlig kontaktliste og viser ikke TING-medlemskap, roller,
              lokallagstilhørighet eller profilinformasjon.
            </p>
          </Panel>
        )}
      </PageContainer>
    );
  }

  // The database returns nothing to someone who may not list the membership.
  // Asking first lets the page explain itself instead of rendering an empty
  // list that looks like a fault.
  if (!canViewDirectory) {
    return (
      <PageContainer>
        <PageHeader eyebrow={community.name} title="Medlemmer" />
        <EmptyState
          title="Medlemslisten er ikke åpen her"
          body={`${community.name} har valgt at bare administratorer kan se hvem som er medlem. Du ser fortsatt navnet på dem som skriver innlegg, kommentarer og meldinger du har tilgang til.`}
        />
      </PageContainer>
    );
  }

  const [members, memberDmActions] = await Promise.all([
    getCommunityMembers(community.id),
    getMemberDmActions(community.id),
  ]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow={community.name}
        title="Medlemmer"
        lead={`${plural(members.length, "aktiv profil", "aktive profiler")} i dette rommet, av totalt ${community.memberCount} registrerte medlemmer i organisasjonen.`}
        action={
          isAdmin ? (
            <ButtonLink href={`/community/${community.id}/requests`} size="sm" variant="secondary">
              Medlemsforespørsler
            </ButtonLink>
          ) : undefined
        }
      />

      <MemberDirectory
        members={members}
        userId={user.id}
        communityId={community.id}
        dmActions={memberDmActions}
      />

      <Panel className="mt-10 flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        {isAdmin ? (
          <IconShield size={20} className="mt-0.5 shrink-0 text-skog" />
        ) : (
          <IconLock size={20} className="mt-0.5 shrink-0 text-skog" />
        )}
        <p className="max-w-2xl text-[13px] leading-relaxed text-ink-2">
          {isAdmin
            ? `Som administrator i ${community.name} kan du invitere nye medlemmer, behandle forespørsler og endre roller. Medlemslisten deles aldri utenfor fellesskapet.`
            : `Medlemslisten er kun synlig for medlemmer av ${community.name}, og vises verken på den offentlige siden eller andre steder på TING.`}
        </p>
      </Panel>
    </PageContainer>
  );
}
