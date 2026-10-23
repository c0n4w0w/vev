import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, cn } from "@/components/ui/primitives";
import { formatFullDate, formatTime } from "@/lib/format";
import type { AuditEntry } from "@/lib/platform/data";
import type { PlatformFormState } from "@/lib/platform/forms";

/** A community's monogram square, from the platform's own fields. */
export function PlatformMark({
  accent,
  monogram,
  markStyle,
  size = "sm",
}: {
  accent: string;
  monogram: string;
  markStyle: "sans" | "serif" | "mono";
  size?: "sm" | "lg";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center font-semibold tracking-[0.04em] text-white",
        size === "sm" ? "h-8 w-8 rounded-[6px] text-[10px]" : "h-16 w-16 rounded-[10px] text-base",
        markStyle === "serif" ? "font-display" : markStyle === "mono" ? "font-mono" : "font-sans",
      )}
      style={{ backgroundColor: accent }}
    >
      {monogram}
    </span>
  );
}

export function PlatformPage({ children, width = "default" }: { children: ReactNode; width?: "default" | "wide" | "narrow" }) {
  const widths = { narrow: "max-w-3xl", default: "max-w-5xl", wide: "max-w-6xl" } as const;
  return <div className={cn("mx-auto px-4 py-8 sm:px-6 lg:px-10 lg:py-10", widths[width])}>{children}</div>;
}

export function PlatformHeader({
  title,
  lead,
  action,
  eyebrow,
  back,
}: {
  title: string;
  lead?: string;
  action?: ReactNode;
  eyebrow?: string;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-8 border-b border-line pb-6">
      {back ? (
        <Link href={back.href} className="mb-3 inline-flex min-h-8 items-center text-sm text-ink-3 hover:text-ink">
          ← {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 max-w-2xl">
          {eyebrow ? <p className="label mb-2">{eyebrow}</p> : null}
          <h1 className="break-words font-display text-[1.75rem] leading-tight text-ink sm:text-[2rem]">{title}</h1>
          {lead ? <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">{lead}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}

export function StatCard({ label, value, href, note }: { label: string; value: number; href?: string; note?: string }) {
  const body = (
    <>
      <p className="text-[13px] text-ink-3">{label}</p>
      <p className="mt-1 font-display text-[2rem] leading-none text-ink">{value.toLocaleString("nb-NO")}</p>
      {note ? <p className="mt-2 text-xs text-ink-3">{note}</p> : null}
    </>
  );
  const className = "block rounded-[6px] border border-line bg-surface px-5 py-4";
  return href ? (
    <Link href={href} className={cn(className, "transition-colors hover:border-line-2 hover:bg-paper-2/40")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function CommunityStatusBadge({ status }: { status: "active" | "suspended" }) {
  return status === "suspended" ? <Badge tone="rust">Suspendert</Badge> : <Badge tone="skog">Aktiv</Badge>;
}

export function RequestStatusBadge({ status }: { status: "pending" | "approved" | "rejected" }) {
  if (status === "approved") return <Badge tone="skog">Godkjent</Badge>;
  if (status === "rejected") return <Badge tone="neutral">Avslått</Badge>;
  return <Badge tone="fjord">Venter</Badge>;
}

export function FormMessage({ state }: { state: PlatformFormState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={cn(
        "rounded-[5px] border px-3 py-2 text-sm",
        state.status === "error" ? "border-[#e7cec4] bg-rust-soft text-rust" : "border-[#cfdfd5] bg-skog-soft text-skog",
      )}
    >
      {state.message}
    </p>
  );
}

export const inputClass =
  "block h-10 w-full rounded-[5px] border border-line-2 bg-surface px-3 text-sm text-ink placeholder:text-ink-3 aria-[invalid=true]:border-rust";
export const textareaClass =
  "block w-full rounded-[5px] border border-line-2 bg-surface px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-ink-3 aria-[invalid=true]:border-rust";

export function Field({
  id,
  label,
  hint,
  error,
  children,
  optional,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {optional ? <span className="ml-1 font-normal text-ink-3">(valgfritt)</span> : null}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-rust">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function formatDateTime(iso: string) {
  return `${formatFullDate(iso)} kl. ${formatTime(iso)}`;
}

const ACTION_LABELS: Record<string, string> = {
  "community.create": "Opprettet fellesskap",
  "community.update": "Endret fellesskap",
  "community.suspend": "Suspenderte fellesskap",
  "community.reactivate": "Reaktiverte fellesskap",
  "community.admin.assign": "Utnevnte administrator",
  "community.admin.invite": "Inviterte administrator",
  "community.admin.accept": "Administratorinvitasjon tatt i bruk",
  "community.admin.remove": "Fjernet administratorrolle",
  "community.admin.invitation.revoke": "Trakk tilbake administratorinvitasjon",
  "community.admin.invitation.resend": "Sendte administratorinvitasjon på nytt",
  "onboarding_request.approve": "Godkjente forespørsel",
  "onboarding_request.reject": "Avslo forespørsel",
  "onboarding_request.note": "Oppdaterte notat på forespørsel",
  "platform_operator.appoint": "Utnevnte plattformadministrator",
  "platform_operator.role": "Endret plattformrolle",
  "platform_operator.revoke": "Fjernet plattformtilgang",
  "platform_operator.bootstrap": "Første plattformeier opprettet",
  "platform_operator.recover": "Plattformeier gjenopprettet",
};

export function auditActionLabel(action: string) {
  return ACTION_LABELS[action] ?? action;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "eier",
  operator: "operatør",
  account: "konto",
  system: "kommandolinje",
};

function targetHref(entry: AuditEntry): string | null {
  if (!entry.targetId) return null;
  if (entry.targetType === "community") return `/platform-admin/fellesskap/${entry.targetId}`;
  if (entry.targetType === "onboarding_request") return `/platform-admin/foresporsler/${entry.targetId}`;
  return null;
}

/** Short, safe facts from the entry's metadata, in words. */
function details(entry: AuditEntry): string[] {
  const m = entry.metadata;
  const lines: string[] = [];
  if (typeof m.reason === "string" && entry.result === "failure") lines.push(`Avvist: ${m.reason}`);
  else if (typeof m.reason === "string") lines.push(`Begrunnelse: ${m.reason}`);
  if (typeof m.note === "string") lines.push(`Notat: ${m.note}`);
  if (typeof m.email === "string") lines.push(m.email);
  if (Array.isArray(m.changed)) lines.push(`Felter: ${m.changed.join(", ")}`);
  const slug = m.slug as { from?: string; to?: string } | string | undefined;
  if (slug && typeof slug === "object") lines.push(`Portal: /${slug.from} → /${slug.to}`);
  if (typeof m.role === "string") lines.push(`Rolle: ${m.role === "owner" ? "eier" : "operatør"}`);
  if (typeof m.from === "string" && typeof m.to === "string") lines.push(`${m.from} → ${m.to}`);
  if (m.replaced === true) lines.push("Erstattet forrige administrator");
  return lines;
}

export function AuditList({ entries, compact }: { entries: AuditEntry[]; compact?: boolean }) {
  if (entries.length === 0) {
    return <p className="rounded-[6px] border border-dashed border-line-2 px-4 py-6 text-center text-sm text-ink-3">Ingen hendelser ennå.</p>;
  }
  return (
    <ol className="divide-y divide-line rounded-[6px] border border-line bg-surface">
      {entries.map((entry) => {
        const href = targetHref(entry);
        const facts = compact ? [] : details(entry);
        return (
          <li key={entry.id} className={cn("flex flex-col gap-1 px-4 py-3", !compact && "md:flex-row md:items-start md:gap-4")}>
            <time dateTime={entry.occurredAt} className={cn("shrink-0 text-xs tabular-nums text-ink-3", !compact && "md:w-44 md:pt-0.5")}>
              {formatDateTime(entry.occurredAt)}
            </time>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">
                <span className="font-medium">{auditActionLabel(entry.action)}</span>
                {entry.targetId ? (
                  <>
                    {" · "}
                    {href ? (
                      <Link href={href} className="underline decoration-line-2 underline-offset-2 hover:decoration-ink">
                        {entry.targetId}
                      </Link>
                    ) : (
                      <span className="font-mono text-[12px] text-ink-2">{entry.targetId}</span>
                    )}
                  </>
                ) : null}
                {entry.result === "failure" ? (
                  <Badge tone="rust" className="ml-2 align-middle">
                    Mislyktes
                  </Badge>
                ) : null}
              </p>
              <p className="mt-0.5 break-words text-xs text-ink-3">
                {entry.actorEmail ?? "Kommandolinjen på serveren"} ({ROLE_LABELS[entry.actorRole] ?? entry.actorRole})
              </p>
              {facts.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
                  {facts.map((fact) => (
                    <li key={fact} className="break-words">
                      {fact}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
