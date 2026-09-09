"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  approveRequestAction,
  rejectRequestAction,
  resendInvitationAction,
} from "@/app/actions";
import { emptyAccessFormState } from "@/lib/access-form";
import { Badge, EmptyState, Panel } from "@/components/ui/primitives";
import { IconMail } from "@/components/ui/icons";
import { formatFullDate, timeUntil } from "@/lib/format";
import type { AccessRequest, CommunityInvitation } from "@/lib/data";

function Submit({ label, pendingLabel, className, style }: {
  label: string;
  pendingLabel: string;
  className: string;
  style?: React.CSSProperties;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} style={style}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function RequestRow({
  request,
  communityId,
  accent,
}: {
  request: AccessRequest;
  communityId: string;
  accent: string;
}) {
  const [approveState, approve] = useActionState(approveRequestAction, emptyAccessFormState);
  const [rejectState, reject] = useActionState(rejectRequestAction, emptyAccessFormState);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const state = approveState.status !== "idle" ? approveState : rejectState;

  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        {request.displayName ? (
          <p className="text-[0.9375rem] font-medium text-ink">{request.displayName}</p>
        ) : null}
        <p className="break-all font-mono text-[13px] text-ink-2">{request.email}</p>
        <p className="mt-0.5 text-[11px] text-ink-3">
          Sendt {formatFullDate(request.createdAt)}
        </p>
        {state.status !== "idle" && state.message ? (
          <p
            role="status"
            className={`mt-2 text-[12px] ${state.status === "error" ? "text-rust" : "text-ink-2"}`}
          >
            {state.message}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {confirmingReject ? (
          <form action={reject} className="flex items-center gap-2">
            <input type="hidden" name="requestId" value={request.id} />
            <input type="hidden" name="communityId" value={communityId} />
            <Submit
              label="Ja, avslå"
              pendingLabel="…"
              className="h-9 rounded-[5px] px-3 text-sm font-medium text-rust transition-opacity hover:opacity-70"
            />
            <button
              type="button"
              onClick={() => setConfirmingReject(false)}
              className="h-9 px-2 text-sm text-ink-3 transition-colors hover:text-ink"
            >
              Avbryt
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirmingReject(true)}
              className="h-9 rounded-[5px] border border-line-2 bg-surface px-3 text-sm text-ink-2 transition-colors hover:bg-paper-2"
            >
              Avslå
            </button>
            <form action={approve}>
              <input type="hidden" name="requestId" value={request.id} />
              <input type="hidden" name="communityId" value={communityId} />
              <Submit
                label="Godkjenn"
                pendingLabel="Sender …"
                className="h-9 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
                style={{ backgroundColor: accent }}
              />
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function InvitationRow({
  invitation,
  communityId,
}: {
  invitation: CommunityInvitation;
  communityId: string;
}) {
  const [state, resend] = useActionState(resendInvitationAction, emptyAccessFormState);
  // Server-decided; the browser's clock has no say in whether a token is live.
  const expired = invitation.expired;

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="break-all font-mono text-[13px] text-ink-2">{invitation.email}</p>
        <p className="mt-0.5 text-[11px] text-ink-3">
          {expired ? "Utløpt" : `Utløper ${timeUntil(invitation.expiresAt)}`} · sendt{" "}
          {formatFullDate(invitation.createdAt)}
        </p>
        {state.status !== "idle" && state.message ? (
          <p
            role="status"
            className={`mt-1.5 text-[12px] ${state.status === "error" ? "text-rust" : "text-ink-2"}`}
          >
            {state.message}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {expired ? <Badge tone="rust">Utløpt</Badge> : <Badge tone="neutral">Venter</Badge>}
        <form action={resend}>
          <input type="hidden" name="invitationId" value={invitation.id} />
          <input type="hidden" name="communityId" value={communityId} />
          <Submit
            label="Send på nytt"
            pendingLabel="Sender …"
            className="h-8 rounded-[5px] border border-line-2 bg-surface px-3 text-[13px] text-ink-2 transition-colors hover:bg-paper-2"
          />
        </form>
      </div>
    </div>
  );
}

/**
 * The admin queue.
 *
 * Rendered only for administrators, but that is presentation: the rows come
 * from a policy scoped to `is_admin(community_id)`, and both approve and
 * reject re-check it in the database. A moderator sees an empty queue and
 * would be refused if they submitted anyway.
 */
export function RequestQueue({
  communityId,
  requests,
  invitations,
  accent,
}: {
  communityId: string;
  requests: AccessRequest[];
  invitations: CommunityInvitation[];
  accent: string;
}) {
  return (
    <div className="space-y-10">
      <section>
        <h2 className="label mb-3">
          {requests.length === 0
            ? "Ingen forespørsler"
            : `${requests.length} ${requests.length === 1 ? "forespørsel" : "forespørsler"} venter`}
        </h2>

        {requests.length === 0 ? (
          <EmptyState
            title="Ingen ventende forespørsler"
            body="Når noen ber om tilgang fra den offentlige siden, havner de her. Godkjenner du, sender VEV en invitasjon på e-post — medlemskapet opprettes først når invitasjonen tas i bruk."
          />
        ) : (
          <Panel className="divide-y divide-line">
            {requests.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                communityId={communityId}
                accent={accent}
              />
            ))}
          </Panel>
        )}
      </section>

      <section>
        <h2 className="label mb-3">Utsendte invitasjoner</h2>
        {invitations.length === 0 ? (
          <p className="text-sm text-ink-3">Ingen invitasjoner venter på å bli tatt i bruk.</p>
        ) : (
          <Panel className="divide-y divide-line">
            {invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                communityId={communityId}
              />
            ))}
          </Panel>
        )}
        <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-ink-3">
          <IconMail size={13} className="mt-px shrink-0" />
          En invitasjon gjelder én e-postadresse, ett fellesskap og én gang. Sender du på nytt,
          slutter den forrige lenken å virke.
        </p>
      </section>
    </div>
  );
}
