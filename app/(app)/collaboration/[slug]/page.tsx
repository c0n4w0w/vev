import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  acceptAndJoinAction,
  declineSponsorshipAction,
  leaveCollaborationAction,
  rejoinCollaborationAction,
  withdrawUnitAction,
} from "@/app/collaboration-actions";
import { ActionButton } from "@/components/collaboration/ActionButton";
import { InviteOrganizationForm } from "@/components/collaboration/InviteOrganizationForm";
import { OrganizationInviteResponse } from "@/components/collaboration/OrganizationInviteResponse";
import { UnitName, unitLabel } from "@/components/collaboration/UnitName";
import { IconArrowLeft, IconLock } from "@/components/ui/icons";
import {
  Avatar,
  ButtonLink,
  PageContainer,
  Panel,
  SectionHeading,
} from "@/components/ui/primitives";
import {
  getCollaborationBySlug,
  getCollaborationTeam,
  getCollaborationUnits,
  getMyCollaborationPersona,
  getMySponsorships,
  getMyTeamStatus,
  hasCollaborationAccess,
  isCollaborationManager,
} from "@/lib/collaboration-data";
import { isRepresented } from "@/lib/collaboration-form";
import { getLocalGroups } from "@/lib/data";
import { translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";
import type { CollaborationUnit, RepresentedCollaborationUnit } from "@/lib/types";

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
 *     then they get the private home: the team as collaboration personas,
 *     the participating organisations, and nothing about who came from where.
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

  const active = units.filter((unit) => unit.status === "active");
  const pending = units.filter((unit) => unit.status === "invited");
  const myUnits = active.filter(isRepresented);
  const ownOrgInvite = pending.filter(isRepresented)[0];
  const mine = sponsorships.filter((sponsorship) => sponsorship.collaborationId === collaboration.id);
  const unitOf = (participantId: string) =>
    active.find((unit) => unit.participantId === participantId);
  const personInvite = mine.find((s) => s.status === "invited" && unitOf(s.participantId));
  const canRejoin =
    !access &&
    teamStatus !== "active" &&
    mine.some((s) => s.status === "accepted" && unitOf(s.participantId));
  const institutional = manager || myUnits.length > 0;

  const team = access ? await getCollaborationTeam(collaboration.id) : [];
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
              {access ? t("collab.orgInvite.acceptedOnTeam") : t("collab.orgInvite.acceptedNotTeam")}
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

        {!access && myUnits.length > 0 ? (
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

            {access ? (
              <>
                <section>
                  <SectionHeading>{t("collab.page.team")}</SectionHeading>
                  <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">
                    {team.map((member) => (
                      <li key={member.id} className="flex items-start gap-3 px-4 py-3.5">
                        <Avatar
                          user={{ ...member, communityId: collaboration.id }}
                          size="md"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">
                            {member.name}
                            {member.id === user.id ? (
                              <span className="ml-1.5 font-normal text-ink-3">
                                ({t("collab.page.you")})
                              </span>
                            ) : null}
                          </p>
                          {member.bio ? (
                            <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
                              {member.bio}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="rounded-[6px] border border-dashed border-line-2 px-5 py-6">
                  <h2 className="font-display text-base text-ink">{t("collab.page.next.title")}</h2>
                  <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-ink-2">
                    {t("collab.page.next.body")}
                  </p>
                </section>
              </>
            ) : null}

            {institutional ? (
              <Management
                t={t}
                collaborationId={collaboration.id}
                slug={slug}
                manager={manager}
                pending={pending}
                myUnits={myUnits}
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

            {access ? (
              <section className="space-y-4 border-t border-line pt-5">
                <ButtonLink href={`/collaboration/${slug}/profile`} variant="secondary" size="sm">
                  {t("collab.page.yourProfile")}
                </ButtonLink>
                <ActionButton
                  action={leaveCollaborationAction}
                  fields={{ collaborationId: collaboration.id, slug }}
                  label={t("collab.page.leave")}
                  variant="quiet"
                  confirm={{ note: t("collab.page.leaveNote"), yes: t("collab.page.leaveConfirm") }}
                />
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </PageContainer>
  );
}

/**
 * The institutional side. Every organisation's own actions are offered only
 * for units the viewer represents; another organisation's unit is a name and
 * nothing else. The database refuses the rest regardless.
 */
function Management({
  t,
  collaborationId,
  slug,
  manager,
  pending,
  myUnits,
}: {
  t: ReturnType<typeof translator>;
  collaborationId: string;
  slug: string;
  manager: boolean;
  pending: CollaborationUnit[];
  myUnits: RepresentedCollaborationUnit[];
}) {
  return (
    <section className="divide-y divide-line rounded-[6px] border border-line bg-surface">
      <div className="px-5 py-4">
        <h2 className="font-display text-lg text-ink">{t("collab.manage.title")}</h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-3">{t("collab.manage.lead")}</p>
      </div>

      {myUnits.length > 0 ? (
        <div className="px-5 py-4">
          <p className="label mb-3">{t("collab.unit.yours")}</p>
          <ul className="space-y-4">
            {myUnits.map((unit) => (
              <li key={unit.key} className="space-y-3">
                <UnitName unit={unit} className="max-w-full text-sm font-medium text-ink" />
                <div className="flex flex-wrap items-start gap-2">
                  <ButtonLink
                    href={`/collaboration/${slug}/units/${unit.participantId}`}
                    size="sm"
                    variant="primary"
                  >
                    {t("collab.unit.chooseOrganizers")}
                  </ButtonLink>
                  <ActionButton
                    action={withdrawUnitAction}
                    fields={{ participantId: unit.participantId, slug }}
                    label={t("collab.unit.withdraw")}
                    variant="quiet"
                    confirm={{ note: t("collab.unit.withdrawNote"), yes: t("collab.unit.withdrawConfirm") }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Who takes part is listed beside the page for everyone; here only
          what a manager additionally sees — invitations still open. */}
      {manager && pending.length > 0 ? (
        <div className="px-5 py-4">
          <p className="label mb-2">{t("collab.manage.invited")}</p>
          <ul className="space-y-1.5 text-sm text-ink-2">
            {pending.map((unit) => (
              <li key={unit.key} className="min-w-0">
                <UnitName unit={unit} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {manager ? (
        <div className="px-5 py-4">
          <p className="mb-3 text-sm font-medium text-ink">{t("collab.manage.inviteTitle")}</p>
          <InviteOrganizationForm collaborationId={collaborationId} slug={slug} />
        </div>
      ) : null}
    </section>
  );
}
