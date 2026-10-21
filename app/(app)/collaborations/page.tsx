import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  acceptAndJoinAction,
  declineSponsorshipAction,
  rejoinCollaborationAction,
} from "@/app/collaboration-actions";
import { ActionButton } from "@/components/collaboration/ActionButton";
import { OrganizationInviteResponse } from "@/components/collaboration/OrganizationInviteResponse";
import { UnitName, unitLabel } from "@/components/collaboration/UnitName";
import { IconArrowRight } from "@/components/ui/icons";
import {
  Badge,
  ButtonLink,
  EmptyState,
  PageContainer,
  PageHeader,
  Panel,
  SectionHeading,
} from "@/components/ui/primitives";
import {
  getCollaborationUnits,
  getMySponsorships,
  getMyTeamStatus,
  getVisibleCollaborations,
  hasCollaborationAccess,
  isCollaborationManager,
} from "@/lib/collaboration-data";
import { isRepresented } from "@/lib/collaboration-form";
import { getCommunitiesForUser, getLocalGroups } from "@/lib/data";
import { getRequestTranslator } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/session";
import type { Collaboration, CollaborationUnit } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getRequestTranslator())("collab.hub.metaTitle") };
}

/**
 * The collaboration inbox.
 *
 * Global, so it speaks the platform's language. Every row comes from what the
 * signed-in person is already related to — collaborations RLS lets them see,
 * the units `collaboration_units()` names for them, their own sponsorships.
 * There is no listing of collaborations or organisations beyond that, and no
 * way from here to anyone's member list.
 *
 * "Manage collaboration" and "Enter organizer workspace" are different links
 * on purpose: an administrator who represents FTR Oslo manages the
 * relationship without being on the team, and is shown exactly that.
 */
export default async function CollaborationsPage() {
  const t = await getRequestTranslator();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [collaborations, sponsorships, communities] = await Promise.all([
    getVisibleCollaborations(),
    getMySponsorships(user.id),
    getCommunitiesForUser(user.id),
  ]);
  const canCreate = communities.some(({ membership }) => membership.role === "admin");

  const entries = await Promise.all(
    collaborations.map(async (collaboration) => {
      const [access, manager, units, teamStatus] = await Promise.all([
        hasCollaborationAccess(collaboration.id),
        isCollaborationManager(collaboration.id),
        getCollaborationUnits(collaboration.id),
        getMyTeamStatus(collaboration.id, user.id),
      ]);
      return { collaboration, access, manager, units, teamStatus };
    }),
  );

  // B. Invitations addressed to an organisation this person represents today.
  const orgInvites = await Promise.all(
    entries.flatMap(({ collaboration, units }) =>
      units
        .filter(isRepresented)
        .filter((unit) => unit.status === "invited")
        .map(async (unit) => ({
          collaboration,
          unit,
          active: units.filter((other) => other.status === "active"),
          localGroups: (await getLocalGroups(unit.communityId))
            .filter((group) => group.active)
            .map((group) => ({ id: group.id, name: group.name })),
        })),
    ),
  );

  // C. The person's own invitations to an organiser team, and teams they may
  // rejoin. Only units that are still taking part can be answered.
  const personInvites = entries.flatMap(({ collaboration, units, access, teamStatus }) =>
    sponsorships
      .filter((sponsorship) => sponsorship.collaborationId === collaboration.id)
      .map((sponsorship) => ({
        collaboration,
        sponsorship,
        unit: units.find(
          (unit) => unit.participantId === sponsorship.participantId && unit.status === "active",
        ),
        access,
        teamStatus,
      }))
      .filter(({ unit }) => Boolean(unit))
      .filter(
        ({ sponsorship, access, teamStatus }) =>
          sponsorship.status === "invited" ||
          (sponsorship.status === "accepted" && !access && teamStatus !== "active"),
      ),
  );
  // One rejoin offer per collaboration, however many units still sponsor them.
  const seenRejoin = new Set<string>();
  const personItems = personInvites.filter(({ collaboration, sponsorship }) => {
    if (sponsorship.status === "invited") return true;
    if (seenRejoin.has(collaboration.id)) return false;
    seenRejoin.add(collaboration.id);
    return true;
  });

  const yours = entries.filter((entry) => entry.access);
  const managed = entries.filter((entry) => entry.manager && !entry.access);
  const nothing =
    yours.length === 0 && managed.length === 0 && orgInvites.length === 0 && personItems.length === 0;

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("collab.hub.eyebrow")}
        title={t("collab.hub.title")}
        lead={t("collab.hub.lead")}
        action={
          canCreate ? (
            <ButtonLink href="/collaborations/new" size="sm">
              {t("collab.hub.new")}
            </ButtonLink>
          ) : undefined
        }
      />

      {nothing ? (
        <EmptyState
          title={t("collab.hub.empty.title")}
          body={canCreate ? t("collab.hub.empty.admin") : t("collab.hub.empty.body")}
        />
      ) : null}

      <div className="space-y-10">
        {orgInvites.length > 0 ? (
          <section>
            <SectionHeading>{t("collab.hub.orgInvites")}</SectionHeading>
            <ul className="space-y-4">
              {orgInvites.map(({ collaboration, unit, active, localGroups }) => (
                <Panel as="li" key={unit.key} className="p-5">
                  <p className="text-[13px] text-ink-3">
                    {t("collab.orgInvite.title", { name: unit.communityName })}
                  </p>
                  <h3 className="mt-1 font-display text-xl leading-tight text-ink">
                    {collaboration.name}
                  </h3>
                  {collaboration.description ? (
                    <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-2">
                      {collaboration.description}
                    </p>
                  ) : null}
                  {active.length > 0 ? (
                    <p className="mt-3 text-[13px] text-ink-2">
                      {t("collab.orgInvite.with", { names: active.map(unitLabel).join(" · ") })}
                    </p>
                  ) : null}
                  <div className="mt-5 border-t border-line pt-5">
                    <OrganizationInviteResponse
                      participantId={unit.participantId}
                      communityId={unit.communityId}
                      communityName={unit.communityName}
                      localGroups={localGroups}
                      slug={collaboration.slug}
                    />
                  </div>
                </Panel>
              ))}
            </ul>
          </section>
        ) : null}

        {personItems.length > 0 ? (
          <section>
            <SectionHeading>{t("collab.hub.personInvites")}</SectionHeading>
            <ul className="space-y-4">
              {personItems.map(({ collaboration, sponsorship, unit }) => (
                <Panel as="li" key={sponsorship.id} className="p-5">
                  <p className="text-[13px] text-ink-3">
                    {sponsorship.status === "invited"
                      ? t("collab.personInvite.title")
                      : t("collab.rejoin.title")}
                  </p>
                  <h3 className="mt-1 font-display text-xl leading-tight text-ink">
                    {collaboration.name}
                  </h3>
                  {/* The person may know which of their OWN organisations
                      chose them. Nobody else's is ever shown. */}
                  {unit ? (
                    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-2">
                      {t("collab.personInvite.via")}
                      <UnitName unit={unit} className="font-medium text-ink" />
                    </p>
                  ) : null}
                  <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
                    {sponsorship.status === "invited"
                      ? t("collab.personInvite.note")
                      : t("collab.rejoin.body")}
                  </p>
                  <div className="mt-4 flex flex-wrap items-start gap-3">
                    {sponsorship.status === "invited" ? (
                      <>
                        <ActionButton
                          action={acceptAndJoinAction}
                          fields={{ sponsorshipId: sponsorship.id, slug: collaboration.slug }}
                          label={t("collab.personInvite.accept")}
                          variant="primary"
                        />
                        <ActionButton
                          action={declineSponsorshipAction}
                          fields={{ sponsorshipId: sponsorship.id, slug: collaboration.slug }}
                          label={t("collab.personInvite.decline")}
                          variant="quiet"
                          confirm={{
                            note: t("collab.personInvite.declineNote"),
                            yes: t("collab.personInvite.declineConfirm"),
                          }}
                        />
                      </>
                    ) : (
                      <ActionButton
                        action={rejoinCollaborationAction}
                        fields={{ collaborationId: collaboration.id, slug: collaboration.slug }}
                        label={t("collab.rejoin.action")}
                        variant="primary"
                      />
                    )}
                  </div>
                </Panel>
              ))}
            </ul>
          </section>
        ) : null}

        {yours.length > 0 ? (
          <section>
            <SectionHeading>{t("collab.hub.yours")}</SectionHeading>
            <ul className="grid gap-4 md:grid-cols-2">
              {yours.map(({ collaboration, units, manager }) => (
                <CollaborationCard
                  key={collaboration.id}
                  collaboration={collaboration}
                  units={units}
                  roles={[t("collab.role.organizer"), ...(manager ? [t("collab.role.manager")] : [])]}
                  cta={t("collab.enterWorkspace")}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {managed.length > 0 ? (
          <section>
            <SectionHeading>{t("collab.hub.managed")}</SectionHeading>
            <p className="-mt-2 mb-4 max-w-2xl text-[13px] leading-relaxed text-ink-3">
              {t("collab.hub.managedLead")}
            </p>
            <ul className="grid gap-4 md:grid-cols-2">
              {managed.map(({ collaboration, units }) => (
                <CollaborationCard
                  key={collaboration.id}
                  collaboration={collaboration}
                  units={units}
                  roles={[t("collab.role.manager")]}
                  cta={t("collab.manage")}
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </PageContainer>
  );
}

async function CollaborationCard({
  collaboration,
  units,
  roles,
  cta,
}: {
  collaboration: Collaboration;
  units: CollaborationUnit[];
  roles: string[];
  cta: string;
}) {
  const active = units.filter((unit) => unit.status === "active");
  const t = await getRequestTranslator();
  return (
    <Panel as="li" className="flex min-w-0 flex-col p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {roles.map((role) => (
          <Badge key={role} tone={role === t("collab.role.organizer") ? "skog" : "outline"}>
            {role}
          </Badge>
        ))}
      </div>
      <h3 className="mt-3 font-display text-lg leading-tight text-ink">{collaboration.name}</h3>
      {collaboration.description ? (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-2">
          {collaboration.description}
        </p>
      ) : null}
      {active.length > 0 ? (
        <ul className="mt-4 space-y-1.5 border-t border-line pt-3.5 text-[13px] text-ink-2">
          {active.map((unit) => (
            <li key={unit.key} className="min-w-0">
              <UnitName unit={unit} />
            </li>
          ))}
        </ul>
      ) : null}
      <Link
        href={`/collaboration/${collaboration.slug}`}
        className="mt-4 inline-flex items-center gap-1.5 self-start rounded-[4px] text-sm font-medium text-skog transition-opacity hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-skog"
      >
        {cta}
        <IconArrowRight size={15} />
      </Link>
    </Panel>
  );
}
