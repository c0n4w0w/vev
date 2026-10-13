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
  cn,
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
  getOrganizationPersonAvatarUrls,
  getOrganizationPersonDmActions,
  getOwnOrganizationPersonIds,
  type LinkedCrewMemberDetails,
} from "@/lib/data";
import { communityLocale, communityTranslator, tn, translator, type Locale } from "@/lib/i18n";
import { publicMemberTitle } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";
import type { CommunityPerson, CommunityPersonSection } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/community/[communityId]/members">) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  const people = community ? await getCommunityPeople(community.id) : [];
  const t = communityTranslator(community);
  const title =
    people.length > 0 && community?.id !== "under-the-rug"
      ? t("members.organizationTitle")
      : t("members.title");
  return { title: `${title} · ${community?.name ?? t("common.communityFallback")}` };
}

const organizationSections = [
  { id: "staff", title: "members.section.staff" },
  { id: "board", title: "members.section.board" },
  { id: "local_group_leader", title: "members.section.localGroupLeaders" },
] as const satisfies { id: CommunityPersonSection; title: string }[];

function GeneralContactBlock({ email, locale }: { email: string; locale: Locale }) {
  const t = translator(locale);
  return (
    <Panel className="mb-8 flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
          {t("members.contact.title")}
        </p>
        <p className="mt-1 text-[13px] text-ink-2">{t("members.contact.body")}</p>
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
  avatarUrls,
  ownPersonIds,
  equalHeight = false,
  locale,
}: {
  locale: Locale;
  title: string;
  people: CommunityPerson[];
  communityId: string;
  dmActions: Map<string, string | undefined>;
  leaders?: boolean;
  /** Explicit-link enrichment, keyed by `community_people.id`. UTR Crew only. */
  linkedDetails?: Map<string, LinkedCrewMemberDetails>;
  /** Linked profile photos the viewer may see, keyed by `community_people.id`. */
  avatarUrls?: Map<string, string>;
  /** `community_people.id` values that belong to the signed-in user. */
  ownPersonIds?: Set<string>;
  /** Stretch cards in a row to the same height. */
  equalHeight?: boolean;
}) {
  if (people.length === 0) return null;

  return (
    <section>
      <SectionHeading>{title}</SectionHeading>
      {/* items-start: a row must not stretch every card to match its tallest
          neighbour — an enriched Crew card (bio/location/DM) sits next to
          plain ones without forcing blank space into them. */}
      <ul className={cn("grid gap-3 sm:grid-cols-2", !equalHeight && "items-start")}>
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
              locale={locale}
              linkedTitle={linkedTitleFor(person.role, details?.title)}
              bio={details?.bio}
              location={details?.location}
              avatarUrl={avatarUrls?.get(person.id)}
              isSelf={ownPersonIds?.has(person.id) ?? false}
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
  locale,
}: {
  members: CommunityMember[];
  userId: string;
  communityId: string;
  dmActions: Map<string, string | undefined>;
  locale: Locale;
}) {
  if (members.length === 0) {
    return (
      <Panel className="p-4 text-[13px] text-ink-3">
        {translator(locale)("members.noneVisible")}
      </Panel>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {members.map((member) => (
        <MemberCard
          key={member.persona.id}
          member={member}
          userId={userId}
          communityId={communityId}
          dmActions={dmActions}
          locale={locale}
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
  const locale = communityLocale(community);
  const t = translator(locale);

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
    const members = allMembers.filter((member) => !crewLinkedMemberIds.has(member.persona.id));

    return (
      <PageContainer>
        <PageHeader
          eyebrow={community.name}
          title={t("members.title")}
          lead={t("members.crewLead")}
        />

        <div className="space-y-10">
          <OrganizationRows
            locale={locale}
            title={t("members.section.crew")}
            people={crew}
            communityId={community.id}
            dmActions={organizationDmActions}
            linkedDetails={crewLinkedDetails}
          />

          {canViewDirectory ? (
            <section>
              <SectionHeading>{t("members.section.members")}</SectionHeading>
              <FlatMemberDirectory
                members={members}
                userId={user.id}
                communityId={community.id}
                dmActions={memberDmActions}
                locale={locale}
              />
            </section>
          ) : (
            <Panel className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
              <IconLock size={20} className="mt-0.5 shrink-0 text-skog" />
              <p className="max-w-2xl text-[13px] leading-relaxed text-ink-2">
                {t("members.crewPrivate", { name: community.name })}
              </p>
            </Panel>
          )}
        </div>
      </PageContainer>
    );
  }

  if (organizationPeople.length > 0) {
    const [organizationDmActions, ownPersonIds, avatarUrls] = await Promise.all([
      getOrganizationPersonDmActions(community.id),
      getOwnOrganizationPersonIds(community.id),
      getOrganizationPersonAvatarUrls(community.id),
    ]);

    return (
      <PageContainer>
        <PageHeader
          eyebrow={community.name}
          title={t("members.organizationTitle")}
          lead={t("members.organizationLead")}
        />

        {community.id === "tryggere-ungdom" ? (
          <GeneralContactBlock email="tryggereungdom@gmail.com" locale={locale} />
        ) : null}

        <div className="space-y-10">
          {organizationSections.map((section) => {
            const people = organizationPeople.filter((person) => person.section === section.id);
            return (
              <OrganizationRows
                key={section.id}
                locale={locale}
                title={t(section.title)}
                people={people}
                communityId={community.id}
                dmActions={organizationDmActions}
                leaders={section.id === "local_group_leader"}
                avatarUrls={avatarUrls}
                ownPersonIds={ownPersonIds}
                equalHeight
              />
            );
          })}
        </div>

        <Panel className="mt-10 flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
          <IconLock size={20} className="mt-0.5 shrink-0 text-skog" />
          <p className="max-w-2xl text-[13px] leading-relaxed text-ink-2">
            {t("members.organizationPrivate", { name: community.name })}
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
        <PageHeader eyebrow={community.name} title={t("members.title")} />
        <EmptyState
          title={t("members.closed.title")}
          body={t("members.closed.body", { name: community.name })}
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
        title={t("members.title")}
        lead={t("members.flatLead", {
          profiles: tn(locale, "members.activeProfiles", members.length),
        })}
        action={
          isAdmin ? (
            <ButtonLink href={`/community/${community.id}/requests`} size="sm" variant="secondary">
              {t("members.requestsButton")}
            </ButtonLink>
          ) : undefined
        }
      />

      <FlatMemberDirectory
        members={members}
        userId={user.id}
        communityId={community.id}
        dmActions={memberDmActions}
        locale={locale}
      />

      <Panel className="mt-10 flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        {isAdmin ? (
          <IconShield size={20} className="mt-0.5 shrink-0 text-skog" />
        ) : (
          <IconLock size={20} className="mt-0.5 shrink-0 text-skog" />
        )}
        <p className="max-w-2xl text-[13px] leading-relaxed text-ink-2">
          {isAdmin
            ? t("members.noteAdmin", { name: community.name })
            : t("members.noteMember", { name: community.name })}
        </p>
      </Panel>
    </PageContainer>
  );
}
