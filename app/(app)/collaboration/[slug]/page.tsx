import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  acceptAndJoinAction,
  declineSponsorshipAction,
  rejoinCollaborationAction,
} from "@/app/collaboration-actions";
import { ActionButton } from "@/components/collaboration/ActionButton";
import { CollaborationManagement } from "@/components/collaboration/CollaborationManagement";
import { OrganizationInviteResponse } from "@/components/collaboration/OrganizationInviteResponse";
import { UnitName, unitLabel } from "@/components/collaboration/UnitName";
import { WorkspaceOverview } from "@/components/collaboration/workspace/WorkspaceOverview";
import { IconArrowLeft, IconLock } from "@/components/ui/icons";
import { PageContainer, Panel, SectionHeading } from "@/components/ui/primitives";
import {
  getCollaborationBySlug,
  getCollaborationUnits,
  getMyCollaborationPersona,
  getMySponsorships,
  getMyTeamStatus,
  hasCollaborationAccess,
  isCollaborationManager,
} from "@/lib/collaboration-data";
import { isRepresented } from "@/lib/collaboration-form";
import { getMyOrganizerRequests } from "@/lib/collaboration-workspace-data";
import { getLocalGroups } from "@/lib/data";
import { translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";

export async function generateMetadata({ params }: PageProps<"/collaboration/[slug]">) {
  const { slug } = await params;
  const collaboration = await getCollaborationBySlug(slug);
  // Nothing for a slug the viewer cannot see: the not-found page titles itself.
  return collaboration ? { title: collaboration.name } : {};
}

/**
 * One collaboration, as the viewer stands in relation to it.
 *
 * Two independent questions, asked of the database separately and never
 * folded into one:
 *
 *   * Is the viewer on the organiser team? (`has_collaboration_access`) —
 *     then they get the workspace overview (`WorkspaceOverview`): what needs
 *     attention, the participating organisations, the team as collaboration
 *     personas, and nothing about who came from where. Their institutional
 *     tools, if they also represent a unit, live on the participants page.
 *   * Does the viewer represent a participating unit? (`represented` from
 *     `collaboration_units`, and `is_collaboration_manager` for the seat) —
 *     then they get the institutional view: invite organisations, choose
 *     their own unit's organisers, withdraw their own unit.
 *
 * A national administrator representing FTR Oslo without living in Oslo has
 * the second and not the first, and is told so plainly.
 */
export default async function CollaborationPage({
  params,
  searchParams,
}: PageProps<"/collaboration/[slug]">) {
  const { slug } = await params;
  const { deltar } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const collaboration = await getCollaborationBySlug(slug);
  if (!collaboration) notFound();
  const t = translator(collaboration.defaultLocale);

  const [access, manager, units, sponsorships, teamStatus] = await Promise.all([
    hasCollaborationAccess(collaboration.id),
    isCollaborationManager(collaboration.id),
    getCollaborationUnits(collaboration.id),
    getMySponsorships(user.id),
    getMyTeamStatus(collaboration.id, user.id),
  ]);

  // On the team but not yet presented as anyone: set that up first. Nothing
  // on this page is shown under another identity in the meantime.
  const persona = access ? await getMyCollaborationPersona(collaboration.id, user.id) : undefined;
  if (access && !persona) redirect(`/collaboration/${slug}/profile`);
  if (access && persona) {
    return <WorkspaceOverview slug={slug} justJoinedUnit={deltar === "1"} />;
  }

  const active = units.filter((unit) => unit.status === "active");
  const pending = units.filter((unit) => unit.status === "invited");
  const myUnits = active.filter(isRepresented);
  const ownOrgInvite = pending.filter(isRepresented)[0];
  const mine = sponsorships.filter((sponsorship) => sponsorship.collaborationId === collaboration.id);
  const unitOf = (participantId: string) =>
    active.find((unit) => unit.participantId === participantId);
  const personInvite = mine.find((s) => s.status === "invited" && unitOf(s.participantId));
  // From here on the viewer is not on the team: everything below is the
  // institutional view, or an invitation to join.
  const canRejoin =
    teamStatus !== "active" &&
    mine.some((s) => s.status === "accepted" && unitOf(s.participantId));
  const institutional = manager || myUnits.length > 0;
  const requests = await getMyOrganizerRequests(myUnits.map((unit) => unit.participantId));

  const ownOrgGroups = ownOrgInvite
    ? (await getLocalGroups(ownOrgInvite.communityId))
        .filter((group) => group.active)
        .map((group) => ({ id: group.id, name: group.name }))
    : [];

  return (
    <PageContainer width="wide">
      <Link
        href="/collaborations"
        className="mb-6 inline-flex items-center gap-1.5 rounded-[4px] text-[13px] text-ink-2 transition-colors hover:text-ink"
      >
        <IconArrowLeft size={14} />
        {t("collab.back")}
      </Link>

      <header className="mb-8 border-b border-line pb-6">
        <p className="label mb-2 inline-flex items-center gap-1.5">
          <IconLock size={12} />
          {t("collab.private")}
        </p>
        <h1 className="font-display text-[1.75rem] leading-tight text-ink [overflow-wrap:anywhere] sm:text-[2.125rem]">
          {collaboration.name}
        </h1>
        {active.length > 0 ? (
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">
            {active.map(unitLabel).join(" · ")}
          </p>
        ) : null}
      </header>

      <div className="space-y-6">
        {deltar === "1" && myUnits.length > 0 ? (
          <Panel role="status" className="border-skog/30 bg-skog-soft/40 p-5">
            <p className="text-[0.9375rem] font-medium text-ink">
              {t("collab.orgInvite.acceptedUnit", { unit: myUnits.map(unitLabel).join(", ") })}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
              {t("collab.orgInvite.acceptedNotTeam")}
            </p>
          </Panel>
        ) : null}

        {ownOrgInvite ? (
          <Panel className="border-skog/30 p-5">
            <p className="text-[13px] text-ink-3">
              {t("collab.orgInvite.title", { name: ownOrgInvite.communityName })}
            </p>
            <div className="mt-4">
              <OrganizationInviteResponse
                participantId={ownOrgInvite.participantId}
                communityId={ownOrgInvite.communityId}
                communityName={ownOrgInvite.communityName}
                localGroups={ownOrgGroups}
                slug={slug}
              />
            </div>
          </Panel>
        ) : null}

        {personInvite ? (
          <Panel className="border-skog/30 p-5">
            <h2 className="font-display text-lg text-ink">{t("collab.personInvite.title")}</h2>
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-2">
              {t("collab.personInvite.via")}
              <UnitName unit={unitOf(personInvite.participantId)!} className="font-medium text-ink" />
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
              {t("collab.personInvite.note")}
            </p>
            <div className="mt-4 flex flex-wrap items-start gap-3">
              <ActionButton
                action={acceptAndJoinAction}
                fields={{ sponsorshipId: personInvite.id, slug }}
                label={t("collab.personInvite.accept")}
                variant="primary"
              />
              <ActionButton
                action={declineSponsorshipAction}
                fields={{ sponsorshipId: personInvite.id, slug }}
                label={t("collab.personInvite.decline")}
                variant="quiet"
                confirm={{
                  note: t("collab.personInvite.declineNote"),
                  yes: t("collab.personInvite.declineConfirm"),
                }}
              />
            </div>
          </Panel>
        ) : canRejoin ? (
          <Panel className="p-5">
            <h2 className="font-display text-lg text-ink">{t("collab.rejoin.title")}</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{t("collab.rejoin.body")}</p>
            <div className="mt-4">
              <ActionButton
                action={rejoinCollaborationAction}
                fields={{ collaborationId: collaboration.id, slug }}
                label={t("collab.rejoin.action")}
                variant="primary"
              />
            </div>
          </Panel>
        ) : null}

        {myUnits.length > 0 ? (
          <Panel className="bg-paper-2/50 p-5">
            <p className="text-[0.9375rem] font-medium text-ink">
              {t("collab.page.managerNotice", { unit: myUnits.map(unitLabel).join(", ") })}
            </p>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-2">
              {t("collab.page.managerNoticeBody")}
            </p>
          </Panel>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-6">
            {collaboration.description ? (
              <section>
                <SectionHeading>{t("collab.page.about")}</SectionHeading>
                <p className="whitespace-pre-line text-[0.9375rem] leading-[1.7] text-ink-2 [overflow-wrap:anywhere]">
                  {collaboration.description}
                </p>
              </section>
            ) : null}

            {institutional ? (
              <CollaborationManagement
                t={t}
                collaborationId={collaboration.id}
                slug={slug}
                manager={manager}
                pending={pending}
                myUnits={myUnits}
                requests={requests}
                locale={collaboration.defaultLocale}
              />
            ) : null}
          </div>

          <aside className="min-w-0 space-y-6">
            <section>
              <SectionHeading>{t("collab.page.participating")}</SectionHeading>
              <ul className="space-y-2 text-sm text-ink-2">
                {active.map((unit) => (
                  <li key={unit.key} className="min-w-0">
                    <UnitName unit={unit} />
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </PageContainer>
  );
}
