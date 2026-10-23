import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestDecision, RequestNoteForm } from "@/components/platform/RequestReview";
import { AuditList, PlatformHeader, PlatformPage, RequestStatusBadge, formatDateTime } from "@/components/platform/ui";
import { Panel } from "@/components/ui/primitives";
import { requireVerifiedOperator } from "@/lib/platform/access";
import { getOnboardingRequest, listAuditEntries } from "@/lib/platform/data";

export const metadata = { title: "Forespørsel" };

export default async function PlatformRequestPage({ params }: PageProps<"/platform-admin/foresporsler/[requestId]">) {
  await requireVerifiedOperator();
  const { requestId } = await params;
  const request = await getOnboardingRequest(requestId);
  if (!request) notFound();
  const activity = await listAuditEntries({ limit: 20, targetType: "onboarding_request", targetId: request.id });

  return (
    <PlatformPage>
      <PlatformHeader
        eyebrow="Forespørsel"
        title={request.organizationName}
        back={{ href: "/platform-admin/foresporsler", label: "Forespørsler" }}
        action={<RequestStatusBadge status={request.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel as="section" aria-labelledby="request-message" className="p-5 sm:p-6">
            <h2 id="request-message" className="font-display text-xl text-ink">
              Hva de skrev
            </h2>
            <p className="mt-3 whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-2">{request.message}</p>
          </Panel>

          <Panel as="section" aria-labelledby="request-contact" className="p-5 sm:p-6">
            <h2 id="request-contact" className="font-display text-xl text-ink">
              Kontakt
            </h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-3">Kontaktperson</dt>
                <dd className="text-ink">{request.contactName}</dd>
              </div>
              <div>
                <dt className="text-ink-3">E-post</dt>
                <dd className="break-all">
                  <a href={`mailto:${request.contactEmail}`} className="text-ink underline decoration-line-2 underline-offset-2">
                    {request.contactEmail}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Nettsted</dt>
                <dd className="break-all text-ink">
                  {request.website ? (
                    <a href={request.website} target="_blank" rel="noreferrer noopener nofollow" className="underline decoration-line-2 underline-offset-2">
                      {request.website}
                    </a>
                  ) : (
                    "–"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Antall medlemmer (oppgitt)</dt>
                <dd className="text-ink">{request.memberEstimate ? request.memberEstimate.toLocaleString("nb-NO") : "–"}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Mottatt</dt>
                <dd className="text-ink">{formatDateTime(request.createdAt)}</dd>
              </div>
              {request.reviewedAt ? (
                <div>
                  <dt className="text-ink-3">Behandlet</dt>
                  <dd className="text-ink">
                    {formatDateTime(request.reviewedAt)}
                    {request.reviewedByEmail ? <span className="block text-xs text-ink-3">av {request.reviewedByEmail}</span> : null}
                  </dd>
                </div>
              ) : null}
            </dl>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel as="section" aria-labelledby="request-decision" className="p-5 sm:p-6">
            <h2 id="request-decision" className="font-display text-xl text-ink">
              Behandling
            </h2>
            <div className="mt-4">
              {request.communityId ? (
                <p className="mb-4 text-sm text-ink-2">
                  Fellesskapet{" "}
                  <Link href={`/platform-admin/fellesskap/${request.communityId}`} className="font-medium text-ink underline underline-offset-2">
                    {request.communityName ?? request.communityId}
                  </Link>{" "}
                  er opprettet fra denne forespørselen.
                </p>
              ) : null}
              <RequestDecision requestId={request.id} status={request.status} hasCommunity={Boolean(request.communityId)} />
            </div>
          </Panel>

          <Panel as="section" aria-label="Notater" className="p-5 sm:p-6">
            <RequestNoteForm requestId={request.id} note={request.reviewNote} />
          </Panel>

          <section aria-labelledby="request-activity">
            <h2 id="request-activity" className="label mb-3">
              Aktivitet
            </h2>
            <AuditList entries={activity} compact />
          </section>
        </div>
      </div>
    </PlatformPage>
  );
}
