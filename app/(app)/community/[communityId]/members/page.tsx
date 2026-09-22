import { notFound, redirect } from "next/navigation";
import { MemberCard } from "@/components/community/MemberCard";
import { OrganizationPersonCard } from "@/components/community/OrganizationPersonCard";
import {
  ButtonLink,
  EmptyState,
  PageContainer,
  PageHeader,
  Panel,
  SectionHeading,
} from "@/components/ui/primitives";
import { IconLock, IconShield } from "@/components/ui/icons";
import {
  canViewMemberDirectory,
  type CommunityMember,
  getCommunityById,
  getCommunityMembers,
  getCommunityPeople,
  getCommunityPeopleLinkedMemberDetails,
  getCommunityPeopleLinkedMemberIds,
  getMemberDmActions,
  getMembership,
  getOrganizationPersonDmActions,
  type LinkedCrewMemberDetails,
} from "@/lib/data";
import { plural } from "@/lib/format";
import { publicMemberTitle } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";
import type { CommunityPerson, CommunityPersonSection } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/members">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  const people = community ? await getCommunityPeople(community.id) : [];
  const title = people.length > 0 && community?.id !== "under-the-rug" ? "Organisasjonen" : "Medlemmer";
  return { title: `${title} · ${community?.name ?? "Fellesskap"}` };
}

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

/**
 * The membership title is worth a second line only when it says something the
 * Crew role doesn't — otherwise it is the same fact twice.
 */
function linkedTitleFor(crewRole: string | undefined, membershipTitle: string | undefined) {
  const title = publicMemberTitle(membershipTitle);
  if (!title) return undefined;
  if (crewRole && title.trim().toLocaleLowerCase("nb-NO") === crewRole.trim().toLocaleLowerCase("nb-NO")) {
    return undefined;
  }
  return title;
}

function OrganizationRows({
  title,
  people,
  communityId,
  dmActions,
  leaders = false,
  linkedDetails,
}: {
  title: string;
  people: CommunityPerson[];
  communityId: string;
  dmActions: Map<string, string | undefined>;
  leaders?: boolean;
  /** Explicit-link enrichment, keyed by `community_people.id`. UTR Crew only. */
  linkedDetails?: Map<string, LinkedCrewMemberDetails>;
}) {
  if (people.length === 0) return null;

  return (
    <section>
      <SectionHeading>{title}</SectionHeading>
      {/* items-start: a row must not stretch every card to match its tallest
          neighbour — an enriched Crew card (bio/location/DM) sits next to
          plain ones without forcing blank space into them. */}
      <ul className="grid items-start gap-3 sm:grid-cols-2">
        {people.map((person) => {
          const details = linkedDetails?.get(person.id);
          return (
            <OrganizationPersonCard
              key={person.id}
              person={person}
              localGroupName={leaders ? person.localGroupName : undefined}
              dmAction={
                dmActions.has(person.id)
                  ? { communityId, conversationId: dmActions.get(person.id) }
                  : undefined
              }
              linkedTitle={linkedTitleFor(person.role, details?.title)}
              bio={details?.bio}
              location={details?.location}
            />
          );
        })}
      </ul>
    </section>
  );
}

function FlatMemberDirectory({
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
  if (members.length === 0) {
    return (
      <Panel className="p-4 text-[13px] text-ink-3">
        Ingen synlige TING-medlemmer ennå.
      </Panel>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {members.map((member) => (
        <MemberCard
          key={member.user.id}
          member={member}
          userId={userId}
          communityId={communityId}
          dmActions={dmActions}
          showJoinedDate={false}
        />
      ))}
    </ul>
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

  if (community.id === "under-the-rug") {
    const [allMembers, organizationDmActions, memberDmActions, crewLinkedMemberIds, crewLinkedDetails] =
      await Promise.all([
        canViewDirectory ? getCommunityMembers(community.id) : Promise.resolve([]),
        getOrganizationPersonDmActions(community.id),
        canViewDirectory ? getMemberDmActions(community.id) : Promise.resolve(new Map()),
        canViewDirectory
          ? getCommunityPeopleLinkedMemberIds(community.id)
          : Promise.resolve(new Set<string>()),
        canViewDirectory
          ? getCommunityPeopleLinkedMemberDetails(community.id)
          : Promise.resolve(new Map<string, LinkedCrewMemberDetails>()),
      ]);
    const crew = organizationPeople.filter((person) => person.section === "crew");
    // A person already shown as a Crew card should not also appear as a plain
    // membership card below it — same product rule as elsewhere on this page:
    // one card per person. Their membership itself is unchanged; this is
    // presentation only, and only for whoever has an explicit Crew link.
    const members = allMembers.filter((member) => !crewLinkedMemberIds.has(member.user.id));

    return (
      <PageContainer>
        <PageHeader
          eyebrow={community.name}
          title="Medlemmer"
          lead="Crew er offentlige roller i kollektivet. Medlemmer er faktiske TING-medlemskap."
          action={
            isAdmin ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <ButtonLink
                  href={`/community/${community.id}/admin/members`}
                  size="sm"
                  variant="secondary"
                >
                  Administrer medlemmer
                </ButtonLink>
                <ButtonLink
                  href={`/community/${community.id}/requests`}
                  size="sm"
                  variant="secondary"
                >
                  Medlemsforespørsler
                </ButtonLink>
                <ButtonLink
                  href={`/community/${community.id}/organization-links`}
                  size="sm"
                  variant="secondary"
                >
                  Administrer kontokoblinger
                </ButtonLink>
              </div>
            ) : undefined
          }
        />

        <div className="space-y-10">
          <OrganizationRows
            title="CREW"
            people={crew}
            communityId={community.id}
            dmActions={organizationDmActions}
            linkedDetails={crewLinkedDetails}
          />

          {canViewDirectory ? (
            <section>
              <SectionHeading>MEDLEMMER</SectionHeading>
              <FlatMemberDirectory
                members={members}
                userId={user.id}
                communityId={community.id}
                dmActions={memberDmActions}
              />
            </section>
          ) : (
            <Panel className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
              <IconLock size={20} className="mt-0.5 shrink-0 text-skog" />
              <p className="max-w-2xl text-[13px] leading-relaxed text-ink-2">
                Medlemslisten i {community.name} er privat. Crew-listen viser offentlige
                roller og er ikke det samme som TING-medlemskap.
              </p>
            </Panel>
          )}
        </div>
      </PageContainer>
    );
  }

  if (organizationPeople.length > 0) {
    const organizationDmActions = await getOrganizationPersonDmActions(community.id);

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
                  href={`/community/${community.id}/admin/members`}
                  size="sm"
                  variant="secondary"
                >
                  Administrer medlemmer
                </ButtonLink>
                <ButtonLink
                  href={`/community/${community.id}/requests`}
                  size="sm"
                  variant="secondary"
                >
                  Medlemsforespørsler
                </ButtonLink>
                <ButtonLink
                  href={`/community/${community.id}/organization-links`}
                  size="sm"
                  variant="secondary"
                >
                  Administrer kontokoblinger
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

        <Panel className="mt-10 flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
          <IconLock size={20} className="mt-0.5 shrink-0 text-skog" />
          <p className="max-w-2xl text-[13px] leading-relaxed text-ink-2">
            Medlemslisten i {community.name} er privat. Organisasjonsoversikten her er en
            separat, offentlig kontaktliste og viser ikke TING-medlemskap, roller,
            lokallagstilhørighet eller profilinformasjon.
          </p>
        </Panel>
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

      <FlatMemberDirectory
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
