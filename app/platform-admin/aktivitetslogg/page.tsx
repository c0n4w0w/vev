import Link from "next/link";
import { AuditList, PlatformHeader, PlatformPage, inputClass } from "@/components/platform/ui";
import { Button, ButtonLink } from "@/components/ui/primitives";
import { requireVerifiedOperator } from "@/lib/platform/access";
import { listAuditEntries } from "@/lib/platform/data";

export const metadata = { title: "Aktivitetslogg" };

const PAGE_SIZE = 50;

const TARGETS = [
  { value: "", label: "Alt" },
  { value: "community", label: "Fellesskap" },
  { value: "onboarding_request", label: "Forespørsler" },
  { value: "invitation", label: "Invitasjoner" },
  { value: "platform_operator", label: "Plattformtilganger" },
] as const;

/**
 * The append-only record. Nothing here can change or remove an entry — the
 * table refuses updates and deletes for every role, the server's included.
 */
export default async function PlatformAuditPage({ searchParams }: PageProps<"/platform-admin/aktivitetslogg">) {
  const access = await requireVerifiedOperator();
  const params = await searchParams;
  const targetType = TARGETS.find((target) => target.value && target.value === params.type)?.value;
  const before = typeof params.for === "string" && /^\d{1,18}$/.test(params.for) ? Number(params.for) : undefined;
  const entries = await listAuditEntries({ limit: PAGE_SIZE, beforeId: before, targetType });
  const last = entries.at(-1);

  const nextQuery = new URLSearchParams();
  if (targetType) nextQuery.set("type", targetType);
  if (last) nextQuery.set("for", String(last.id));

  return (
    <PlatformPage>
      <PlatformHeader
        eyebrow="Plattformadministrasjon"
        title="Aktivitetslogg"
        lead={
          access.role === "owner"
            ? "Alle handlinger i plattformadministrasjonen, også avviste forsøk. Loggen kan ikke endres eller slettes."
            : "Handlinger på fellesskap, forespørsler og invitasjoner. Endringer i plattformtilganger vises bare for eiere."
        }
      />

      <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <label htmlFor="audit-type" className="block text-sm font-medium text-ink">
            Gjelder
          </label>
          <select id="audit-type" name="type" defaultValue={targetType ?? ""} className={`${inputClass} mt-1.5`}>
            {TARGETS.filter((target) => access.role === "owner" || target.value !== "platform_operator").map((target) => (
              <option key={target.value} value={target.value}>
                {target.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Vis
        </Button>
        {targetType || before ? (
          <ButtonLink href="/platform-admin/aktivitetslogg" variant="ghost">
            Til nyeste
          </ButtonLink>
        ) : null}
      </form>

      <AuditList entries={entries} />

      {entries.length === PAGE_SIZE ? (
        <div className="mt-5">
          <Link href={`/platform-admin/aktivitetslogg?${nextQuery}`} className="text-sm text-ink underline underline-offset-2">
            Eldre hendelser →
          </Link>
        </div>
      ) : null}
    </PlatformPage>
  );
}
