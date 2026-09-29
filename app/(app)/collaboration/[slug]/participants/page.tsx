import { leaveCollaborationAction } from "@/app/collaboration-actions";
import { ActionButton } from "@/components/collaboration/ActionButton";
import { CollaborationManagement } from "@/components/collaboration/CollaborationManagement";
import { UnitName } from "@/components/collaboration/UnitName";
import { Avatar, ButtonLink, PageContainer, PageHeader, SectionHeading } from "@/components/ui/primitives";
import { getCollaborationUnits, isCollaborationManager } from "@/lib/collaboration-data";
import { isRepresented } from "@/lib/collaboration-form";
import { getMyOrganizerRequests, getWorkspaceTeam, loadWorkspace } from "@/lib/collaboration-workspace-data";

export async function generateMetadata({ params }: PageProps<"/collaboration/[slug]/participants">) {
  const { slug } = await params;
  const { t, collaboration } = await loadWorkspace(slug);
  return { title: `${t("ws.people.title")} · ${collaboration.name}` };
}

/**
 * Two lists that are never merged: the ORGANISATIONS taking part, and the
 * PEOPLE on the collaboration team. Organisations appear by name only; people
 * only if they joined themselves, and only as their collaboration persona —
 * no account, email, community profile, or which organisation vouched for
 * whom. Nobody else from any participating organisation appears here.
 *
 * The institutional tools (invite organisations, choose your own unit's
 * participants, withdraw your unit) sit below, for representatives only.
 */
export default async function ParticipantsPage({ params }: PageProps<"/collaboration/[slug]/participants">) {
  const { slug } = await params;
  const { collaboration, me, t, base } = await loadWorkspace(slug);
  const [units, team, manager] = await Promise.all([
    getCollaborationUnits(collaboration.id),
    getWorkspaceTeam(collaboration.id),
    isCollaborationManager(collaboration.id),
  ]);
  const active = units.filter((unit) => unit.status === "active");
  const pending = units.filter((unit) => unit.status === "invited");
  const myUnits = active.filter(isRepresented);
  const requests = await getMyOrganizerRequests(myUnits.map((unit) => unit.participantId));

  return (
    <PageContainer width="default">
      <PageHeader title={t("ws.people.title")} lead={t("ws.people.lead")} />

      <div className="space-y-10">
        <section>
          <SectionHeading>{t("ws.people.orgs")}</SectionHeading>
          <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">
            {active.map((unit) => (
              <li key={unit.key} className="px-4 py-3 text-sm text-ink">
                <UnitName unit={unit} className="max-w-full" />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12.5px] text-ink-3">{t("ws.people.orgsNote")}</p>
        </section>

        <section>
          <SectionHeading>{t("ws.people.team")}</SectionHeading>
          <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">
            {team.map((person) => (
              <li key={person.id} className="flex items-start gap-3 px-4 py-3.5">
                <Avatar user={{ ...person, communityId: collaboration.id }} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">
                    {person.name}
                    {person.id === me.id ? (
                      <span className="ml-1.5 font-normal text-ink-3">({t("collab.page.you")})</span>
                    ) : null}
                  </p>
                  {person.bio ? (
                    <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{person.bio}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12.5px] text-ink-3">{t("ws.people.teamNote")}</p>
          <div className="mt-4 flex flex-wrap items-start gap-3">
            <ButtonLink href={`${base}/profile`} variant="secondary" size="sm">
              {t("collab.page.yourProfile")}
            </ButtonLink>
            <ActionButton
              action={leaveCollaborationAction}
              fields={{ collaborationId: collaboration.id, slug: collaboration.slug }}
              label={t("collab.page.leave")}
              variant="quiet"
              confirm={{ note: t("collab.page.leaveNote"), yes: t("collab.page.leaveConfirm") }}
            />
          </div>
        </section>

        {manager || myUnits.length > 0 ? (
          <div id="ansvar" className="scroll-mt-6">
            <CollaborationManagement
              t={t}
              collaborationId={collaboration.id}
              slug={collaboration.slug}
              manager={manager}
              pending={pending}
              myUnits={myUnits}
              requests={requests}
              locale={collaboration.defaultLocale}
            />
          </div>
        ) : null}
      </div>
    </PageContainer>
  );
}
