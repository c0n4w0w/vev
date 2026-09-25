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
  getCommunityMemberAccounts,
  getCommunityMembers,
  getCommunityPeople,
  getCommunityPersonAccountLinks,
  getMembership,
} from "@/lib/data";
import { communityLocale, communityTranslator, translator, type Locale, type Translator } from "@/lib/i18n";
import { roleLabel } from "@/lib/roles";
import { getSessionUser } from "@/lib/session";
import type { CommunityPerson } from "@/lib/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ communityId: string }>;
}) {
  const { communityId } = await params;
  const community = await getCommunityById(communityId);
  const t = communityTranslator(community);
  return { title: `${t("links.title")} · ${community?.name ?? t("common.communityFallback")}` };
}

function personSubtitle(person: CommunityPerson) {
  return [person.role, person.localGroupName].filter(Boolean).join(" · ");
}

/**
 * A candidate in the account picker: the member as this community knows them,
 * plus the account identifiers an administrator needs to tell two similar
 * names apart.
 */
type LinkCandidate = CommunityMember & { account?: { handle: string; email: string } };

function memberOptionLabel({ persona, membership, account }: LinkCandidate, locale: Locale) {
  return [
    persona.name,
    account ? `@${account.handle}` : undefined,
    membership.title ?? roleLabel(membership.role, locale),
    account?.email,
  ]
    .filter(Boolean)
    .join(" · ");
}

function linkedLabel(
  link: CommunityPersonAccountLink | undefined,
  membersById: Map<string, LinkCandidate>,
  t: Translator,
) {
  if (!link) return t("links.unlinked");
  const member = membersById.get(link.userId);
  if (member) {
    return member.account
      ? `${member.persona.name} / @${member.account.handle}`
      : member.persona.name;
  }
  return t("links.inactive");
}

function AccountPicker({
  person,
  members,
  communityId,
  link,
  submitLabel,
  locale,
}: {
  person: CommunityPerson;
  members: LinkCandidate[];
  communityId: string;
  link?: CommunityPersonAccountLink;
  submitLabel: string;
  locale: Locale;
}) {
  const t = translator(locale);
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
        aria-label={t("links.accountFor", { name: person.name })}
      >
        <option value="">{t("links.chooseMember")}</option>
        {members.map((member) => (
          <option key={member.persona.id} value={member.persona.id}>
            {memberOptionLabel(member, locale)}
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
  locale,
}: {
  person: CommunityPerson;
  members: LinkCandidate[];
  communityId: string;
  link?: CommunityPersonAccountLink;
  locale: Locale;
}) {
  const t = translator(locale);
  const membersById = new Map(members.map((member) => [member.persona.id, member]));
  const isLinked = Boolean(link);

  return (
    <Panel as="li" className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-medium text-ink">{person.name}</p>
          <p className="mt-0.5 text-[13px] text-ink-2">{personSubtitle(person)}</p>
          <p className="mt-2 text-[13px] text-ink-3">
            <span className="font-medium text-ink-2">
              {isLinked ? t("links.linkedTo") : t("links.tingAccount")}
            </span>{" "}
            {linkedLabel(link, membersById, t)}
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
              {isLinked ? t("links.switch") : t("links.link")}
            </summary>
            <AccountPicker
              person={person}
              members={members}
              communityId={communityId}
              link={link}
              locale={locale}
              submitLabel={isLinked ? t("links.saveSwitch") : t("links.submitLink")}
            />
          </details>
          {isLinked ? (
            <form action={setCommunityPersonAccountLinkAction}>
              <input type="hidden" name="communityId" value={communityId} />
              <input type="hidden" name="personId" value={person.id} />
              <input type="hidden" name="userId" value="" />
              <button type="submit" className={buttonClass({ variant: "quiet", size: "sm" })}>
                {t("links.remove")}
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
  locale,
}: {
  locale: Locale;
  title: string;
  empty: string;
  people: CommunityPerson[];
  links: Map<string, CommunityPersonAccountLink>;
  members: LinkCandidate[];
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
              locale={locale}
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
  const locale = communityLocale(community);
  const t = translator(locale);

  const [membership, people] = await Promise.all([
    getMembership(user.id, community.id),
    getCommunityPeople(community.id),
  ]);

  if (people.length === 0) notFound();

  if (membership?.role !== "admin") {
    return (
      <PageContainer width="narrow">
        <PageHeader eyebrow={community.name} title={t("links.title")} />
        <EmptyState
          title={t("common.adminsOnly")}
          body={t("links.adminsOnly", { name: community.name })}
        />
      </PageContainer>
    );
  }

  const [communityMembers, accounts, links] = await Promise.all([
    getCommunityMembers(community.id),
    getCommunityMemberAccounts(community.id),
    getCommunityPersonAccountLinks(community.id),
  ]);
  const members: LinkCandidate[] = communityMembers.map((member) => ({
    ...member,
    account: accounts.get(member.persona.id),
  }));
  const linked = people.filter((person) => links.has(person.id));
  const unlinked = people.filter((person) => !links.has(person.id));

  return (
    <PageContainer>
      <PageHeader
        eyebrow={community.name}
        title={t("links.title")}
        lead={t("links.lead")}
        action={
          <ButtonLink href={`/community/${community.id}/members`} size="sm" variant="secondary">
            {t("links.backTo", {
              target:
                community.id === "under-the-rug"
                  ? t("members.title")
                  : t("members.organizationTitle"),
            })}
          </ButtonLink>
        }
      />

      <div className="space-y-10">
        <LinkGroup
          locale={locale}
          title={t("links.unlinked")}
          empty={t("links.allLinked")}
          people={unlinked}
          links={links}
          members={members}
          communityId={community.id}
        />
        <LinkGroup
          locale={locale}
          title={t("links.linked")}
          empty={t("links.noneLinked")}
          people={linked}
          links={links}
          members={members}
          communityId={community.id}
        />
      </div>
    </PageContainer>
  );
}
