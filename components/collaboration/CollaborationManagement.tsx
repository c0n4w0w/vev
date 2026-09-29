import { withdrawUnitAction } from "@/app/collaboration-actions";
import { setOrganizerConsentAction } from "@/app/collaboration-workspace-actions";
import { ActionButton } from "@/components/collaboration/ActionButton";
import { InviteOrganizationForm } from "@/components/collaboration/InviteOrganizationForm";
import { UnitName } from "@/components/collaboration/UnitName";
import { ButtonLink } from "@/components/ui/primitives";
import { formatEventRange, formatFullDate, formatTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n/locales";
import type { Translator } from "@/lib/i18n";
import type { CollaborationUnit, OrganizerRequest, RepresentedCollaborationUnit } from "@/lib/types";

/**
 * The institutional side. Every organisation's own actions are offered only
 * for units the viewer represents; another organisation's unit is a name and
 * nothing else. The database refuses the rest regardless.
 *
 * Shown on the collaboration's front page to a representative who is not on
 * the team, and on the workspace's participants page to one who is.
 *
 * Requests to name the viewer's own unit as a public organiser are answered
 * here, by that unit's representative — whether or not they are on the team.
 * Each shows only the event's publishable fields.
 */
export function CollaborationManagement({
  t,
  collaborationId,
  slug,
  manager,
  pending,
  myUnits,
  requests,
  locale,
}: {
  t: Translator;
  requests: OrganizerRequest[];
  locale: Locale;
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
                {requests.some((r) => r.participantId === unit.participantId) ? (
                  <div className="rounded-[6px] border border-line bg-paper/60 p-3.5">
                    <p className="text-[13px] font-medium text-ink">{t("collab.requests.title")}</p>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{t("collab.requests.lead")}</p>
                    <ul className="mt-3 space-y-3">
                      {requests
                        .filter((r) => r.participantId === unit.participantId)
                        .map((request) => (
                          <li key={request.eventId} className="border-t border-line pt-3 first:border-0 first:pt-0">
                            <p className="text-sm text-ink [overflow-wrap:anywhere]">{request.title}</p>
                            <p className="mt-0.5 text-[12.5px] text-ink-3">
                              {request.startsAt
                                ? request.endsAt
                                  ? formatEventRange(request.startsAt, request.endsAt, locale)
                                  : `${formatFullDate(request.startsAt, locale)}, ${formatTime(request.startsAt, locale)}`
                                : t("ws.events.noDate")}
                              {request.location ? ` · ${request.location}` : ""}
                              {` · ${t(`ws.events.audience.${request.audience}`)}`}
                            </p>
                            <p className={`mt-1 text-[12.5px] ${request.consented ? "text-skog" : "text-ink-2"}`}>
                              {request.listed
                                ? t("collab.requests.listed")
                                : request.consented
                                  ? t("collab.requests.approved")
                                  : t("collab.requests.pending")}
                            </p>
                            <div className="mt-2">
                              {request.consented ? (
                                <ActionButton
                                  action={setOrganizerConsentAction}
                                  fields={{ eventId: request.eventId, participantId: unit.participantId, consent: "0", slug }}
                                  label={t("collab.requests.revoke")}
                                  variant="quiet"
                                  ariaLabel={`${t("collab.requests.revoke")}: ${request.title}`}
                                  confirm={{ note: t("collab.requests.revokeNote"), yes: t("collab.requests.revokeConfirm") }}
                                />
                              ) : (
                                <ActionButton
                                  action={setOrganizerConsentAction}
                                  fields={{ eventId: request.eventId, participantId: unit.participantId, consent: "1", slug }}
                                  label={t("collab.requests.approve")}
                                  variant="secondary"
                                  ariaLabel={`${t("collab.requests.approve")}: ${request.title}`}
                                />
                              )}
                            </div>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
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
