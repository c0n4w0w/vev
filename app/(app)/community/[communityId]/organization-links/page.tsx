import { notFound, redirect } from "next/navigation";
import { setCommunityPersonAccountLinkAction } from "@/app/actions";
import {
  ButtonLink,
  EmptyState,
  PageContainer,
  PageHeader,
  Panel,
  SectionHeading,
  buttonClass,
  cn,
} from "@/components/ui/primitives";
import {
  type CommunityMember,
  type CommunityPersonAccountLink,
  getCommunityById,
  getCommunityMembers,
  getCommunityPeople,
  getCommunityPersonAccountLinks,
  getMembership,
  getRole,
} from "@/lib/data";
import { getSessionUser } from "@/lib/session";
import type { CommunityPerson } from "@/lib/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ communityId: string }>;
}) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  return { title: `Kontokoblinger · ${community?.name ?? "Fellesskap"}` };
}

function personSubtitle(person: CommunityPerson) {
  return [person.role, person.localGroupName].filter(Boolean).join(" · ");
}

function memberOptionLabel({ user, membership }: CommunityMember) {
  return [
    user.name,
    `@${user.handle}`,
    membership.title ?? getRole(membership.role).label,
    user.email,
  ].join(" · ");
}

function linkedLabel(
  link: CommunityPersonAccountLink | undefined,
  membersById: Map<string, CommunityMember>,
) {
  if (!link) return "Ikke koblet";
  const member = membersById.get(link.userId);
  if (member) return `${member.user.name} / @${member.user.handle}`;
  return "Koblet konto er ikke aktiv i dette fellesskapet";
}

function AccountPicker({
  person,
  members,
  communityId,
  link,
  submitLabel,
}: {
  person: CommunityPerson;
  members: CommunityMember[];
  communityId: string;
  link?: CommunityPersonAccountLink;
  submitLabel: string;
}) {
  return (
    <form
      action={setCommunityPersonAccountLinkAction}
      className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <input type="hidden" name="communityId" value={communityId} />
      <input type="hidden" name="personId" value={person.id} />
      <select
        name="userId"
        defaultValue={link?.userId ?? ""}
        className="h-9 min-w-0 rounded-[5px] border border-line-2 bg-surface px-2 text-[13px] text-ink outline-none focus:border-ink-3 sm:w-80"
        aria-label={`TING-konto for ${person.name}`}
      >
        <option value="">Velg aktivt medlem</option>
        {members.map((member) => (
          <option key={member.user.id} value={member.user.id}>
            {memberOptionLabel(member)}
          </option>
        ))}
      </select>
      <button type="submit" className={buttonClass({ variant: "secondary", size: "sm" })}>
        {submitLabel}
      </button>
    </form>
  );
}

function LinkRow({
  person,
  members,
  communityId,
  link,
}: {
  person: CommunityPerson;
  members: CommunityMember[];
  communityId: string;
  link?: CommunityPersonAccountLink;
}) {
  const membersById = new Map(members.map((member) => [member.user.id, member]));
  const isLinked = Boolean(link);

  return (
    <Panel as="li" className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-medium text-ink">{person.name}</p>
          <p className="mt-0.5 text-[13px] text-ink-2">{personSubtitle(person)}</p>
          <p className="mt-2 text-[13px] text-ink-3">
            <span className="font-medium text-ink-2">
              {isLinked ? "Koblet til" : "TING-konto"}
            </span>{" "}
            {linkedLabel(link, membersById)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <details className="group">
            <summary
              className={cn(
                buttonClass({ variant: isLinked ? "secondary" : "primary", size: "sm" }),
                "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
              )}
            >
              {isLinked ? "Bytt konto" : "Koble til konto"}
            </summary>
            <AccountPicker
              person={person}
              members={members}
              communityId={communityId}
              link={link}
              submitLabel={isLinked ? "Lagre bytte" : "Koble til"}
            />
          </details>
          {isLinked ? (
            <form action={setCommunityPersonAccountLinkAction}>
              <input type="hidden" name="communityId" value={communityId} />
              <input type="hidden" name="personId" value={person.id} />
              <input type="hidden" name="userId" value="" />
              <button type="submit" className={buttonClass({ variant: "quiet", size: "sm" })}>
                Fjern kobling
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function LinkGroup({
  title,
  empty,
  people,
  links,
  members,
  communityId,
}: {
  title: string;
  empty: string;
  people: CommunityPerson[];
  links: Map<string, CommunityPersonAccountLink>;
  members: CommunityMember[];
  communityId: string;
}) {
  return (
    <section>
      <SectionHeading>{title}</SectionHeading>
      {people.length > 0 ? (
        <ul className="space-y-3">
          {people.map((person) => (
            <LinkRow
              key={person.id}
              person={person}
              members={members}
              communityId={communityId}
              link={links.get(person.id)}
            />
          ))}
        </ul>
      ) : (
        <Panel className="p-4 text-[13px] text-ink-3">{empty}</Panel>
      )}
    </section>
  );
}

export default async function OrganizationLinksPage({
  params,
}: {
  params: Promise<{ communityId: string }>;
}) {
  const { communityId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const community = await getCommunityById(communityId);
  if (!community) notFound();

  const [membership, people] = await Promise.all([
    getMembership(user.id, community.id),
    getCommunityPeople(community.id),
  ]);

  if (people.length === 0) notFound();

  if (membership?.role !== "admin") {
    return (
      <PageContainer width="narrow">
        <PageHeader eyebrow={community.name} title="Kontokoblinger" />
        <EmptyState
          title="Kun for administratorer"
          body={`Det er administratorene i ${community.name} som kobler offentlige organisasjonskontakter til TING-kontoer.`}
        />
      </PageContainer>
    );
  }

  const [members, links] = await Promise.all([
    getCommunityMembers(community.id),
    getCommunityPersonAccountLinks(community.id),
  ]);
  const linked = people.filter((person) => links.has(person.id));
  const unlinked = people.filter((person) => !links.has(person.id));

  return (
    <PageContainer>
      <PageHeader
        eyebrow={community.name}
        title="Kontokoblinger"
        lead="Koble offentlige organisasjonskontakter til eksisterende TING-kontoer for funksjoner som direkte meldinger."
        action={
          <ButtonLink href={`/community/${community.id}/members`} size="sm" variant="secondary">
            Tilbake til Organisasjonen
          </ButtonLink>
        }
      />

      <div className="space-y-10">
        <LinkGroup
          title="Ikke koblet"
          empty="Alle organisasjonskontakter er koblet."
          people={unlinked}
          links={links}
          members={members}
          communityId={community.id}
        />
        <LinkGroup
          title="Koblet"
          empty="Ingen organisasjonskontakter er koblet ennå."
          people={linked}
          links={links}
          members={members}
          communityId={community.id}
        />
      </div>
    </PageContainer>
  );
}
