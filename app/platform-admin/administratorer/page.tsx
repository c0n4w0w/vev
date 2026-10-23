import { AppointOperatorForm, OperatorList, ReauthPanel } from "@/components/platform/OperatorManagement";
import { AuditList, PlatformHeader, PlatformPage } from "@/components/platform/ui";
import { EmptyState, Panel } from "@/components/ui/primitives";
import { requireVerifiedOperator } from "@/lib/platform/access";
import { listAuditEntries, listPlatformOperators } from "@/lib/platform/data";

export const metadata = { title: "Plattformadministratorer" };

export default async function PlatformOperatorsPage() {
  const access = await requireVerifiedOperator();

  if (access.role !== "owner") {
    return (
      <PlatformPage>
        <PlatformHeader eyebrow="Plattformadministrasjon" title="Plattformadministratorer" />
        <EmptyState
          title="Bare for plattformeiere"
          body="Det er plattformeierne som utnevner og fjerner plattformadministratorer. Kontakt en eier hvis noen skal få eller miste tilgang."
        />
      </PlatformPage>
    );
  }

  const [operators, history] = await Promise.all([
    listPlatformOperators(),
    listAuditEntries({ limit: 30, targetType: "platform_operator" }),
  ]);
  const active = operators.filter((operator) => !operator.revokedAt);
  const revoked = operators.filter((operator) => operator.revokedAt);
  const locked = !access.mfaRecent;

  return (
    <PlatformPage>
      <PlatformHeader
        eyebrow="Plattformadministrasjon"
        title="Plattformadministratorer"
        lead="Hvem som driver TING. Plattformtilgang er adskilt fra roller i fellesskapene og gir ingen tilgang til innholdet der."
      />

      <div className="space-y-6">
        {locked ? <ReauthPanel /> : null}

        <section aria-labelledby="operators-active">
          <h2 id="operators-active" className="label mb-3">
            Aktive ({active.length})
          </h2>
          <OperatorList operators={active} disabled={locked} />
        </section>

        <Panel as="section" aria-labelledby="operators-appoint" className="p-5 sm:p-6">
          <h2 id="operators-appoint" className="font-display text-xl text-ink">
            Utnevn plattformadministrator
          </h2>
          <div className="mt-4">
            <AppointOperatorForm disabled={locked} />
          </div>
        </Panel>

        {revoked.length > 0 ? (
          <section aria-labelledby="operators-revoked">
            <h2 id="operators-revoked" className="label mb-3">
              Tidligere ({revoked.length})
            </h2>
            <OperatorList operators={revoked} disabled />
          </section>
        ) : null}

        <section aria-labelledby="operators-history">
          <h2 id="operators-history" className="label mb-3">
            Historikk
          </h2>
          <AuditList entries={history} />
        </section>

        <p className="text-xs leading-relaxed text-ink-3">
          Har ingen eier tilgang lenger (for eksempel tapt telefon), gjenopprettes en eier fra serverens kommandolinje:{" "}
          <code className="font-mono">npm run platform:owner -- --email … --recover --confirm</code>. Se docs/platform-admin.md.
        </p>
      </div>
    </PlatformPage>
  );
}
