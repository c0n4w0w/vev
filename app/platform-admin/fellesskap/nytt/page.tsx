import { CreateCommunityWizard, type WizardPrefill } from "@/components/platform/CreateCommunityWizard";
import { PlatformHeader, PlatformPage } from "@/components/platform/ui";
import { requireVerifiedOperator } from "@/lib/platform/access";
import { getOnboardingRequest } from "@/lib/platform/data";

export const metadata = { title: "Nytt fellesskap" };

/**
 * The creation wizard. Each render issues a new creation key; submitting the
 * same rendered form twice (a double click, a resend after a timeout) reaches
 * platform_create_community() with the same key and creates one community.
 *
 * `?foresporsel=<id>` starts from an onboarding request: the organisation's
 * name and the contact's address are filled in, and the request is linked —
 * and marked approved — in the same transaction that creates the community.
 */
export default async function NewCommunityPage({ searchParams }: PageProps<"/platform-admin/fellesskap/nytt">) {
  await requireVerifiedOperator();
  const params = await searchParams;
  const requestId = typeof params.foresporsel === "string" ? params.foresporsel : undefined;
  const request = requestId ? await getOnboardingRequest(requestId) : null;

  const prefill: WizardPrefill =
    request && request.status !== "rejected" && !request.communityId
      ? {
          requestId: request.id,
          name: request.organizationName,
          adminEmail: request.contactEmail,
          requestLabel: `${request.organizationName} (${request.contactName})`,
        }
      : {};

  return (
    <PlatformPage width="wide">
      <PlatformHeader
        eyebrow="Fellesskap"
        title="Nytt fellesskap"
        lead="Opprett en organisasjon på TING med trygge standardvalg og en vei til den første administratoren."
        back={request ? { href: `/platform-admin/foresporsler/${request.id}`, label: "Tilbake til forespørselen" } : { href: "/platform-admin/fellesskap", label: "Fellesskap" }}
      />
      {request && (request.status === "rejected" || request.communityId) ? (
        <p role="alert" className="mb-6 rounded-[5px] border border-[#e7cec4] bg-rust-soft px-3 py-2 text-sm text-rust">
          {request.communityId
            ? "Det er allerede opprettet et fellesskap for denne forespørselen. Skjemaet under er ikke knyttet til den."
            : "Forespørselen er avslått. Skjemaet under er ikke knyttet til den."}
        </p>
      ) : null}
      <CreateCommunityWizard creationKey={crypto.randomUUID()} prefill={prefill} />
    </PlatformPage>
  );
}
