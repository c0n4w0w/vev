import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revokeSponsorshipAction, sponsorOrganizerAction } from "@/app/collaboration-actions";
import { ActionButton } from "@/components/collaboration/ActionButton";
import { unitLabel } from "@/components/collaboration/UnitName";
import { IconArrowLeft } from "@/components/ui/icons";
import { Avatar, Badge, EmptyState, PageContainer, PageHeader } from "@/components/ui/primitives";
import {
  getCollaborationBySlug,
  getCollaborationUnits,
  getOrganizerCandidates,
} from "@/lib/collaboration-data";
import { isRepresented } from "@/lib/collaboration-form";
import { translator, type MessageKey } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";
import type { OrganizerState } from "@/lib/types";

export async function generateMetadata({
  params,
}: PageProps<"/collaboration/[slug]/units/[participantId]">) {
  const { slug } = await params;
  const collaboration = await getCollaborationBySlug(slug);
  if (!collaboration) return {};
  return {
    title: translator(collaboration.defaultLocale)("collab.organizers.metaTitle", { name: collaboration.name }),
  };
}

const statusKey: Record<OrganizerState, MessageKey> = {
  none: "collab.organizers.status.none",
  invited: "collab.organizers.status.invited",
  joined: "collab.organizers.status.joined",
  left: "collab.organizers.status.left",
  accepted: "collab.organizers.status.accepted",
  declined: "collab.organizers.status.declined",
  revoked: "collab.organizers.status.revoked",
};

const statusTone = {
  none: "outline",
  invited: "fjord",
  joined: "skog",
  left: "neutral",
  accepted: "fjord",
  declined: "neutral",
  revoked: "neutral",
} as const;

/**
 * Choosing organisers from ONE unit the viewer represents.
 *
 * The page renders only for a unit `collaboration_units()` marks as the
 * viewer's own. The people listed come from the viewer's ordinary view of
 * their own organisation's registry — the same rows their member
 * administration already shows them — narrowed to this unit's local group
 * when there is one. There is no collaboration-wide member list behind this
 * page, so pointing it at another organisation's unit yields nothing to show,
 * and `invite_collaboration_member()` would refuse the invitation anyway.
 */
export default async function ChooseOrganizersPage({
  params,
}: PageProps<"/collaboration/[slug]/units/[participantId]">) {
  const { slug, participantId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const collaboration = await getCollaborationBySlug(slug);
  if (!collaboration) notFound();
  const t = translator(collaboration.defaultLocale);

  const unit = (await getCollaborationUnits(collaboration.id)).filter(isRepresented).find(
    (candidate) =>
      candidate.participantId === participantId &&
      candidate.represented &&
      candidate.status === "active",
  );
  if (!unit) notFound();

  const candidates = await getOrganizerCandidates(unit);
  const label = unitLabel(unit);

  return (
    <PageContainer width="narrow">
      <Link
        href={`/collaboration/${slug}`}
        className="mb-6 inline-flex items-center gap-1.5 rounded-[4px] text-[13px] text-ink-2 transition-colors hover:text-ink"
      >
        <IconArrowLeft size={14} />
        {collaboration.name}
      </Link>
      <PageHeader
        eyebrow={t("collab.hub.eyebrow")}
        title={t("collab.organizers.title", { unit: label })}
        lead={t("collab.organizers.lead", { unit: label })}
      />

      {candidates.length === 0 ? (
        <EmptyState title={label} body={t("collab.organizers.empty")} />
      ) : (
        <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">
          {candidates.map(({ persona, membership, sponsorship, state: status }) => {
            // Invited, accepted, on the team or left: the unit's choice still
            // stands and can be withdrawn. Declined or revoked: ask again.
            const live = sponsorship?.status === "invited" || sponsorship?.status === "accepted";
            return (
              <li
                key={membership.userId}
                className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar user={persona} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {persona.name}
                      {membership.userId === user.id ? (
                        <span className="ml-1.5 font-normal text-ink-3">
                          ({t("collab.organizers.you")})
                        </span>
                      ) : null}
                    </p>
                    <Badge tone={statusTone[status]} className="mt-1">
                      {t(statusKey[status])}
                    </Badge>
                  </div>
                </div>
                <div className="shrink-0 sm:text-right">
                  {live && sponsorship ? (
                    <ActionButton
                      action={revokeSponsorshipAction}
                      fields={{ sponsorshipId: sponsorship.id, slug }}
                      label={t("collab.organizers.revoke")}
                      ariaLabel={`${t("collab.organizers.revoke")}: ${persona.name}`}
                      variant="quiet"
                      confirm={{
                        note: t("collab.organizers.revokeNote"),
                        yes: t("collab.organizers.revokeConfirm"),
                      }}
                    />
                  ) : (
                    <ActionButton
                      action={sponsorOrganizerAction}
                      fields={{
                        collaborationId: collaboration.id,
                        participantId: unit.participantId,
                        userId: membership.userId,
                        slug,
                      }}
                      label={
                        status === "none"
                          ? t("collab.organizers.invite")
                          : t("collab.organizers.reinvite")
                      }
                      ariaLabel={`${
                        status === "none"
                          ? t("collab.organizers.invite")
                          : t("collab.organizers.reinvite")
                      }: ${persona.name}`}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageContainer>
  );
}
