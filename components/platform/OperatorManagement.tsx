"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { appointOperatorAction, revokeOperatorAction, setOperatorRoleAction } from "@/app/platform-admin/actions";
import { MfaVerifyForm } from "@/components/platform/MfaGate";
import { Field, FormMessage, formatDateTime, inputClass } from "@/components/platform/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Button } from "@/components/ui/primitives";
import { IconShield } from "@/components/ui/icons";
import type { PlatformOperatorRow } from "@/lib/platform/data";
import { idleState, type PlatformFormState } from "@/lib/platform/forms";

/**
 * Changing who holds platform privileges asks for a second-factor
 * verification in the last ten minutes. The database enforces it
 * (platform_require(owner, fresh)); this panel is how an owner provides it.
 */
export function ReauthPanel() {
  return (
    <div className="rounded-[6px] border border-[#cddce4] bg-fjord-soft/60 px-5 py-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-fjord">
          <IconShield size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">Bekreft med engangskode</p>
          <p className="mt-1 text-sm text-ink-2">
            Endringer i plattformtilganger krever at du har bekreftet med autentiseringsappen de siste ti minuttene.
          </p>
          <div className="mt-4">
            <MfaVerifyForm submitLabel="Bekreft" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppointOperatorForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState(appointOperatorAction, idleState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "ok") formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <Field id="operator-email" label="E-postadresse" error={state.fields?.email} hint="En eksisterende TING-konto med bekreftet adresse og passord.">
          <input id="operator-email" name="email" type="email" autoComplete="off" required className={inputClass} disabled={disabled} />
        </Field>
        <Field id="operator-role" label="Rolle">
          <select id="operator-role" name="role" defaultValue="operator" className={inputClass} disabled={disabled}>
            <option value="operator">Operatør</option>
            <option value="owner">Eier</option>
          </select>
        </Field>
      </div>
      <p className="text-xs leading-relaxed text-ink-3">
        Operatører kan opprette og forvalte fellesskap og forespørsler. Eiere kan i tillegg utnevne og fjerne plattformadministratorer. Ingen av
        rollene gir tilgang til samtaler, innlegg eller medlemslister i fellesskapene.
      </p>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending || disabled}>
        {pending ? "Utnevner …" : "Utnevn"}
      </Button>
    </form>
  );
}

function OperatorActions({ operator, disabled }: { operator: PlatformOperatorRow; disabled: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState(setOperatorRoleAction, idleState);
  const [open, setOpen] = useState(false);
  const [revokeState, revokeAction, revokePending] = useActionState(async (previous: PlatformFormState, formData: FormData) => {
    const next = await revokeOperatorAction(previous, formData);
    setOpen(false);
    return next;
  }, idleState);
  const titleId = useId();

  if (operator.isSelf) return <p className="text-xs text-ink-3">Din egen tilgang endres av en annen eier.</p>;
  const nextRole = operator.role === "owner" ? "operator" : "owner";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={roleAction}>
          <input type="hidden" name="userId" value={operator.userId} />
          <input type="hidden" name="role" value={nextRole} />
          <Button type="submit" variant="secondary" size="sm" disabled={rolePending || disabled}>
            {nextRole === "owner" ? "Gjør til eier" : "Gjør til operatør"}
          </Button>
        </form>
        <Button type="button" variant="secondary" size="sm" className="text-rust" onClick={() => setOpen(true)} disabled={disabled}>
          Fjern tilgang
        </Button>
      </div>
      <FormMessage state={roleState} />
      <FormMessage state={revokeState} />
      <ConfirmDialog open={open} onClose={() => setOpen(false)} labelledBy={titleId}>
        <form action={revokeAction}>
          <input type="hidden" name="userId" value={operator.userId} />
          <h2 id={titleId} className="font-display text-lg text-ink">
            Fjerne plattformtilgangen?
          </h2>
          <p className="mt-2 text-sm text-ink-2">
            {operator.email} mister tilgangen til plattformadministrasjonen fra neste forespørsel. Kontoen og medlemskapene i fellesskap berøres
            ikke.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Avbryt
            </Button>
            <Button type="submit" disabled={revokePending} className="bg-rust hover:bg-rust/90">
              Fjern tilgang
            </Button>
          </div>
        </form>
      </ConfirmDialog>
    </div>
  );
}

export function OperatorList({ operators, disabled }: { operators: PlatformOperatorRow[]; disabled: boolean }) {
  return (
    <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">
      {operators.map((operator) => (
        <li key={operator.userId} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
              {operator.name ?? operator.email}
              {operator.revokedAt ? (
                <Badge tone="neutral">Fjernet</Badge>
              ) : (
                <Badge tone={operator.role === "owner" ? "skog" : "fjord"}>{operator.role === "owner" ? "Eier" : "Operatør"}</Badge>
              )}
              {operator.isSelf ? <Badge tone="outline">Deg</Badge> : null}
              {!operator.revokedAt && !operator.hasMfa ? <Badge tone="rust">Mangler tofaktor</Badge> : null}
            </p>
            <p className="break-all text-sm text-ink-3">{operator.email}</p>
            <p className="mt-1 text-xs text-ink-3">
              {operator.revokedAt
                ? `Fjernet ${formatDateTime(operator.revokedAt)}${operator.revokedByEmail ? ` av ${operator.revokedByEmail}` : ""}`
                : `Utnevnt ${formatDateTime(operator.appointedAt)}${operator.appointedByEmail ? ` av ${operator.appointedByEmail}` : " fra kommandolinjen"}`}
            </p>
          </div>
          {!operator.revokedAt ? <OperatorActions operator={operator} disabled={disabled} /> : null}
        </li>
      ))}
    </ul>
  );
}
