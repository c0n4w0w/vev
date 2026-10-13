"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  approveRequestAction,
  rejectRequestAction,
  resendInvitationAction,
} from "@/app/actions";
import { emptyAccessFormState, type AccessFormState } from "@/lib/access-form";
import { Badge, EmptyState, Panel } from "@/components/ui/primitives";
import { IconMail } from "@/components/ui/icons";
import { formatFullDate, timeUntil } from "@/lib/format";
import { tn, type MessageKey } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/react";
import type { AccessRequest, AccessRequestResolution, CommunityInvitation } from "@/lib/data";

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
  onResult,
}: {
  request: AccessRequest;
  communityId: string;
  accent: string;
  /** A decided request leaves this list, and its row with it; the queue keeps the outcome. */
  onResult: (state: AccessFormState) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [approveState, approve] = useActionState(async (prev: AccessFormState, formData: FormData) => {
    const next = await approveRequestAction(prev, formData);
    onResult(next);
    return next;
  }, emptyAccessFormState);
  const [rejectState, reject] = useActionState(async (prev: AccessFormState, formData: FormData) => {
    const next = await rejectRequestAction(prev, formData);
    onResult(next);
    return next;
  }, emptyAccessFormState);
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
          {t("requests.sent", { date: formatFullDate(request.createdAt, locale) })}
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
              label={t("requests.rejectYes")}
              pendingLabel="…"
              className="h-9 rounded-[5px] px-3 text-sm font-medium text-rust transition-opacity hover:opacity-70"
            />
            <button
              type="button"
              onClick={() => setConfirmingReject(false)}
              className="h-9 px-2 text-sm text-ink-3 transition-colors hover:text-ink"
            >
              {t("common.cancel")}
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirmingReject(true)}
              className="h-9 rounded-[5px] border border-line-2 bg-surface px-3 text-sm text-ink-2 transition-colors hover:bg-paper-2"
            >
              {t("requests.reject")}
            </button>
            <form action={approve}>
              <input type="hidden" name="requestId" value={request.id} />
              <input type="hidden" name="communityId" value={communityId} />
              <Submit
                label={t("requests.approve")}
                pendingLabel={t("common.sending")}
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
  onResult,
}: {
  invitation: CommunityInvitation;
  communityId: string;
  /** Resending replaces this invitation, and its row with it; the queue keeps the outcome. */
  onResult: (state: AccessFormState) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [, resend] = useActionState(async (prev: AccessFormState, formData: FormData) => {
    const next = await resendInvitationAction(prev, formData);
    onResult(next);
    return next;
  }, emptyAccessFormState);
  // Server-decided; the browser's clock has no say in whether a token is live.
  const expired = invitation.expired;

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="break-all font-mono text-[13px] text-ink-2">{invitation.email}</p>
        <p className="mt-0.5 text-[11px] text-ink-3">
          {expired
            ? t("requests.expired")
            : t("requests.expires", { when: timeUntil(invitation.expiresAt, locale) })}{" "}
          · {t("requests.sentLower", { date: formatFullDate(invitation.createdAt, locale) })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {expired ? (
          <Badge tone="rust">{t("requests.expired")}</Badge>
        ) : (
          <Badge tone="neutral">{t("requests.pending")}</Badge>
        )}
        <form action={resend}>
          <input type="hidden" name="invitationId" value={invitation.id} />
          <input type="hidden" name="communityId" value={communityId} />
          <Submit
            label={t("requests.resend")}
            pendingLabel={t("common.sending")}
            className="h-8 rounded-[5px] border border-line-2 bg-surface px-3 text-[13px] text-ink-2 transition-colors hover:bg-paper-2"
          />
        </form>
      </div>
    </div>
  );
}

const RESOLUTION_LABEL: Record<
  AccessRequestResolution["resolution"],
  { text: MessageKey; tone: "skog" | "neutral" | "rust" }
> = {
  activated: { text: "requests.status.active", tone: "skog" },
  invitation_accepted: { text: "requests.status.active", tone: "skog" },
  invitation_pending: { text: "requests.status.awaitingLogin", tone: "neutral" },
  invitation_expired: { text: "requests.status.linkExpired", tone: "rust" },
  rejected: { text: "requests.status.rejected", tone: "rust" },
};

function HistoryRow({ entry }: { entry: AccessRequestResolution }) {
  const t = useT();
  const locale = useLocale();
  const { text, tone } = RESOLUTION_LABEL[entry.resolution];
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        {entry.displayName ? (
          <p className="text-[0.9375rem] font-medium text-ink">{entry.displayName}</p>
        ) : null}
        <p className="break-all font-mono text-[13px] text-ink-2">{entry.email}</p>
        <p className="mt-0.5 text-[11px] text-ink-3">
          {entry.reviewedAt
            ? t("requests.reviewed", { date: formatFullDate(entry.reviewedAt, locale) })
            : null}
        </p>
      </div>
      <div className="shrink-0">
        <Badge tone={tone}>{t(text)}</Badge>
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
  history,
  accent,
}: {
  communityId: string;
  requests: AccessRequest[];
  invitations: CommunityInvitation[];
  history: AccessRequestResolution[];
  accent: string;
}) {
  const t = useT();
  const locale = useLocale();
  // The last approve/reject outcome — including "approved, but the email
  // could not be sent" — which would otherwise vanish with its row.
  const [notice, setNotice] = useState<AccessFormState | null>(null);
  // Likewise for a resend: it issues a new invitation, so the row that was
  // clicked is gone by the time there is something to say — most of all when
  // the email could not be sent.
  const [resendNotice, setResendNotice] = useState<AccessFormState | null>(null);
  return (
    <div className="space-y-10">
      <section>
        <h2 className="label mb-3">
          {requests.length === 0
            ? t("requests.noneHeading")
            : tn(locale, "requests.waiting", requests.length)}
        </h2>

        {notice && notice.status !== "idle" && notice.message ? (
          <p
            role="status"
            className={`mb-3 rounded-[5px] border px-3 py-2 text-[13px] leading-relaxed ${
              notice.status === "error" ? "border-rust/25 bg-rust-soft text-rust" : "border-line bg-surface text-ink-2"
            }`}
          >
            {notice.message}
          </p>
        ) : null}

        {requests.length === 0 ? (
          <EmptyState
            title={t("requests.empty.title")}
            body={t("requests.empty.body")}
          />
        ) : (
          <Panel className="divide-y divide-line">
            {requests.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                communityId={communityId}
                accent={accent}
                onResult={setNotice}
              />
            ))}
          </Panel>
        )}
      </section>

      <section>
        <h2 className="label mb-3">{t("requests.invitations")}</h2>
        {resendNotice && resendNotice.status !== "idle" && resendNotice.message ? (
          <p
            role="status"
            className={`mb-3 rounded-[5px] border px-3 py-2 text-[13px] leading-relaxed ${
              resendNotice.status === "error" ? "border-rust/25 bg-rust-soft text-rust" : "border-line bg-surface text-ink-2"
            }`}
          >
            {resendNotice.message}
          </p>
        ) : null}
        {invitations.length === 0 ? (
          <p className="text-sm text-ink-3">{t("requests.noInvitations")}</p>
        ) : (
          <Panel className="divide-y divide-line">
            {invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                communityId={communityId}
                onResult={setResendNotice}
              />
            ))}
          </Panel>
        )}
        <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-ink-3">
          <IconMail size={13} className="mt-px shrink-0" />
          {t("requests.invitationNote")}
        </p>
      </section>

      {history.length > 0 ? (
        <section>
          <h2 className="label mb-3">{t("requests.recent")}</h2>
          <Panel className="divide-y divide-line">
            {history.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} />
            ))}
          </Panel>
        </section>
      ) : null}
    </div>
  );
}
