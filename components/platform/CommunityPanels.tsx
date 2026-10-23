"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  assignAdminAction,
  reactivateCommunityAction,
  removeAdminAction,
  removeCommunityLogoAction,
  resendAdminInvitationAction,
  revokeAdminInvitationAction,
  setCommunityLogoAction,
  suspendCommunityAction,
  updateCommunityAction,
} from "@/app/platform-admin/actions";
import { Field, FormMessage, PlatformMark, formatDateTime, inputClass, textareaClass } from "@/components/platform/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button, cn } from "@/components/ui/primitives";
import type { PlatformAdminInvitation, PlatformCommunityDetail } from "@/lib/platform/data";
import {
  ACCENT_PRESETS,
  ACCESS_POLICY_LABELS,
  DIRECTORY_LABELS,
  DM_POLICY_LABELS,
  LOCALE_LABELS,
  MARK_STYLE_LABELS,
  idleState,
  isHexColor,
  type PlatformFormState,
} from "@/lib/platform/forms";

type Action = (state: PlatformFormState, formData: FormData) => Promise<PlatformFormState>;

/** A button that asks first, in a native modal, then submits its own small form. */
function ConfirmedAction({
  action,
  hidden,
  label,
  title,
  body,
  confirmLabel,
  tone = "secondary",
}: {
  action: Action;
  hidden: Record<string, string>;
  label: string;
  title: string;
  body: string;
  confirmLabel: string;
  tone?: "secondary" | "danger";
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (previous: PlatformFormState, formData: FormData) => {
    const next = await action(previous, formData);
    setOpen(false);
    return next;
  }, idleState);
  const titleId = useId();
  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)} className={tone === "danger" ? "text-rust" : undefined}>
        {label}
      </Button>
      <FormMessage state={state} />
      <ConfirmDialog open={open} onClose={() => setOpen(false)} labelledBy={titleId}>
        <form action={formAction}>
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <h2 id={titleId} className="font-display text-lg text-ink">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">{body}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Avbryt
            </Button>
            <Button type="submit" disabled={pending} className={tone === "danger" ? "bg-rust hover:bg-rust/90" : undefined}>
              {pending ? "Vent …" : confirmLabel}
            </Button>
          </div>
        </form>
      </ConfirmDialog>
    </div>
  );
}

export function CommunityEditForm({ community }: { community: PlatformCommunityDetail }) {
  const [state, action, pending] = useActionState(updateCommunityAction, idleState);
  const [accent, setAccent] = useState(community.accent);
  const [monogram, setMonogram] = useState(community.monogram);
  const [markStyle, setMarkStyle] = useState(community.markStyle);
  const errors = state.fields ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="communityId" value={community.id} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="edit-name" label="Navn" error={errors.name}>
          <input id="edit-name" name="name" defaultValue={community.name} maxLength={80} required className={inputClass} aria-invalid={Boolean(errors.name)} />
        </Field>
        <Field id="edit-slug" label="Portaladresse" error={errors.slug} hint="Endres adressen, slutter den gamle lenken å virke.">
          <input id="edit-slug" name="slug" defaultValue={community.slug} maxLength={50} required className={`${inputClass} font-mono`} aria-invalid={Boolean(errors.slug)} spellCheck={false} autoCapitalize="none" />
        </Field>
      </div>
      <Field id="edit-tagline" label="Kort beskrivelse" optional error={errors.tagline}>
        <input id="edit-tagline" name="tagline" defaultValue={community.tagline} maxLength={140} className={inputClass} />
      </Field>
      <Field id="edit-description" label="Offentlig beskrivelse" optional error={errors.publicDescription}>
        <textarea id="edit-description" name="publicDescription" defaultValue={community.publicDescription} maxLength={1000} rows={4} className={textareaClass} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="edit-location" label="Sted" optional error={errors.location}>
          <input id="edit-location" name="location" defaultValue={community.location} maxLength={80} className={inputClass} />
        </Field>
        <Field id="edit-year" label="Etablert år" error={errors.foundedYear}>
          <input id="edit-year" name="foundedYear" defaultValue={String(community.foundedYear)} inputMode="numeric" maxLength={4} className={inputClass} aria-invalid={Boolean(errors.foundedYear)} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <p id="edit-accent-label" className="text-sm font-medium text-ink">Farge</p>
          <div role="radiogroup" aria-labelledby="edit-accent-label" className="mt-2 flex flex-wrap gap-2">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                role="radio"
                aria-checked={accent === preset.value}
                onClick={() => setAccent(preset.value)}
                className={cn("h-8 w-8 rounded-full border-2", accent === preset.value ? "border-ink" : "border-transparent")}
                style={{ backgroundColor: preset.value }}
                title={preset.label}
              >
                <span className="sr-only">{preset.label}</span>
              </button>
            ))}
            <input name="accent" value={accent} onChange={(event) => setAccent(event.target.value.toLowerCase())} maxLength={7} aria-label="Fargekode" className={`${inputClass} w-28 font-mono`} aria-invalid={Boolean(errors.accent)} />
          </div>
          {errors.accent ? <p className="mt-1 text-xs text-rust">{errors.accent}</p> : null}
        </div>
        <Field id="edit-monogram" label="Monogram" error={errors.monogram}>
          <input id="edit-monogram" name="monogram" value={monogram} onChange={(event) => setMonogram(event.target.value.toUpperCase())} maxLength={3} className={`${inputClass} w-24 uppercase`} />
        </Field>
        <Field id="edit-mark" label="Skrift">
          <select id="edit-mark" name="markStyle" value={markStyle} onChange={(event) => setMarkStyle(event.target.value as typeof markStyle)} className={inputClass}>
            {Object.entries(MARK_STYLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <PlatformMark accent={isHexColor(accent) ? accent : community.accent} monogram={monogram || "?"} markStyle={markStyle} />
        <span className="text-xs text-ink-3">Forhåndsvisning av monogrammet</span>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="edit-access" label="Tilgang">
          <select id="edit-access" name="accessPolicy" defaultValue={community.accessPolicy} className={inputClass}>
            {Object.entries(ACCESS_POLICY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field id="edit-locale" label="Språk">
          <select id="edit-locale" name="defaultLocale" defaultValue={community.defaultLocale} className={inputClass}>
            {Object.entries(LOCALE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field id="edit-directory" label="Medlemslisten">
          <select id="edit-directory" name="memberDirectoryVisibility" defaultValue={community.memberDirectoryVisibility} className={inputClass}>
            {Object.entries(DIRECTORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field id="edit-dm" label="Direktemeldinger">
          <select id="edit-dm" name="dmPolicy" defaultValue={community.dmPolicy} className={inputClass}>
            {Object.entries(DM_POLICY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
      </div>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Lagrer …" : "Lagre endringer"}
      </Button>
    </form>
  );
}

export function CommunityLogoForm({ communityId, hasAvatar }: { communityId: string; hasAvatar: boolean }) {
  const [state, action, pending] = useActionState(setCommunityLogoAction, idleState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "ok") formRef.current?.reset();
  }, [state]);
  return (
    <div className="space-y-4">
      <form ref={formRef} action={action} className="space-y-3">
        <input type="hidden" name="communityId" value={communityId} />
        <Field id="logo-file" label={hasAvatar ? "Bytt logo" : "Last opp logo"} hint="PNG, JPEG eller WebP, minst 64 × 64 piksler og høyst 5 MB.">
          <input id="logo-file" name="logo" type="file" accept="image/png,image/jpeg,image/webp" required className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-[5px] file:border file:border-line-2 file:bg-surface file:px-3 file:py-2 file:text-sm" />
        </Field>
        <FormMessage state={state} />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Laster opp …" : "Lagre logo"}
        </Button>
      </form>
      {hasAvatar ? (
        <ConfirmedAction
          action={removeCommunityLogoAction}
          hidden={{ communityId }}
          label="Fjern logo"
          title="Fjerne logoen?"
          body="Monogrammet vises i stedet. Bildet slettes."
          confirmLabel="Fjern logo"
        />
      ) : null}
    </div>
  );
}

export function AdminManagement({
  community,
  invitations,
}: {
  community: PlatformCommunityDetail;
  invitations: PlatformAdminInvitation[];
}) {
  const [state, action, pending] = useActionState(assignAdminAction, idleState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "ok") formRef.current?.reset();
  }, [state]);
  const suspended = community.status === "suspended";

  return (
    <div className="space-y-6">
      {community.admin ? (
        <div className="flex flex-col gap-3 rounded-[6px] border border-line bg-paper px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-medium text-ink">{community.admin.name ?? "Ukjent navn"}</p>
            <p className="break-all text-sm text-ink-3">{community.admin.email}</p>
            {community.admin.since ? <p className="text-xs text-ink-3">Medlem siden {community.admin.since}</p> : null}
          </div>
          <ConfirmedAction
            action={removeAdminAction}
            hidden={{ communityId: community.id }}
            label="Fjern administratorrollen"
            title="Fjerne administratorrollen?"
            body={`${community.admin.email ?? "Personen"} blir vanlig medlem. Medlemskapet og alt personen har skrevet blir værende. Fellesskapet har ingen administrator før du utnevner en ny.`}
            confirmLabel="Fjern rollen"
            tone="danger"
          />
        </div>
      ) : (
        <p className="rounded-[6px] border border-dashed border-[#e7cec4] bg-rust-soft/50 px-4 py-3 text-sm text-rust">
          Fellesskapet har ingen aktiv administrator.
        </p>
      )}

      {invitations.length > 0 ? (
        <div>
          <h3 className="label mb-2">Åpne administratorinvitasjoner</h3>
          <ul className="divide-y divide-line rounded-[6px] border border-line">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 text-sm">
                  <p className="break-all font-medium text-ink">{invitation.email}</p>
                  <p className="text-xs text-ink-3">
                    Sendt {formatDateTime(invitation.createdAt)} · gyldig til {formatDateTime(invitation.expiresAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ConfirmedAction
                    action={resendAdminInvitationAction}
                    hidden={{ invitationId: invitation.id }}
                    label="Send på nytt"
                    title="Sende invitasjonen på nytt?"
                    body={`${invitation.email} får en ny lenke. Den forrige slutter å virke.`}
                    confirmLabel="Send"
                  />
                  <ConfirmedAction
                    action={revokeAdminInvitationAction}
                    hidden={{ invitationId: invitation.id }}
                    label="Trekk tilbake"
                    title="Trekke tilbake invitasjonen?"
                    body="Lenken slutter å virke med en gang."
                    confirmLabel="Trekk tilbake"
                    tone="danger"
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form ref={formRef} action={action} className="space-y-4" noValidate>
        <input type="hidden" name="communityId" value={community.id} />
        <h3 className="label">{community.admin ? "Utnevn en annen administrator" : "Utnevn administrator"}</h3>
        <Field id="admin-email" label="E-postadresse" error={state.fields?.email}>
          <input id="admin-email" name="email" type="email" autoComplete="off" required className={inputClass} disabled={suspended} />
        </Field>
        {community.admin ? (
          <label className="flex items-start gap-2 text-sm text-ink-2">
            <input type="checkbox" name="replace" className="mt-1" disabled={suspended} />
            <span>
              Erstatt {community.admin.email ?? "nåværende administrator"}. Det virker bare for en eksisterende konto med bekreftet adresse og passord;
              den nåværende administratoren blir vanlig medlem.
            </span>
          </label>
        ) : null}
        <p className="text-xs leading-relaxed text-ink-3">
          En konto med bekreftet adresse og passord blir administrator med en gang. Ellers sendes en invitasjon som bare kan tas i bruk med akkurat
          denne adressen.
        </p>
        <FormMessage state={state} />
        <Button type="submit" disabled={pending || suspended}>
          {pending ? "Utnevner …" : "Utnevn"}
        </Button>
        {suspended ? <p className="text-xs text-ink-3">Fellesskapet er suspendert. Reaktiver det før du endrer administrator.</p> : null}
      </form>
    </div>
  );
}

export function SuspensionPanel({ community }: { community: PlatformCommunityDetail }) {
  const [open, setOpen] = useState(false);
  const [suspendState, suspend, suspending] = useActionState(async (previous: PlatformFormState, formData: FormData) => {
    const next = await suspendCommunityAction(previous, formData);
    if (next.status === "ok") setOpen(false);
    return next;
  }, idleState);
  const [reactivateState, reactivate, reactivating] = useActionState(reactivateCommunityAction, idleState);
  const titleId = useId();

  if (community.status === "suspended") {
    return (
      <div className="space-y-4">
        <div className="rounded-[6px] border border-[#e7cec4] bg-rust-soft/60 px-4 py-3 text-sm text-ink-2">
          <p className="font-medium text-rust">Suspendert {community.suspendedAt ? formatDateTime(community.suspendedAt) : ""}</p>
          {community.suspendedByEmail ? <p className="mt-1 text-xs text-ink-3">Av {community.suspendedByEmail}</p> : null}
          {community.suspensionReason ? <p className="mt-2 whitespace-pre-line">{community.suspensionReason}</p> : null}
        </div>
        <form action={reactivate} className="space-y-3">
          <input type="hidden" name="communityId" value={community.id} />
          <Field id="reactivate-note" label="Notat" optional hint="Lagres i aktivitetsloggen.">
            <textarea id="reactivate-note" name="note" rows={2} maxLength={1000} className={textareaClass} />
          </Field>
          <FormMessage state={reactivateState} />
          <Button type="submit" disabled={reactivating}>
            {reactivating ? "Reaktiverer …" : "Reaktiver fellesskapet"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-ink-2">
        Når et fellesskap er suspendert, kan ingen lese eller skrive noe i det – heller ikke via API-et. Medlemmer ser bare at det er suspendert,
        og den offentlige portalen svarer som om den ikke fantes. Ingenting slettes: medlemskap, meldinger og filer blir liggende til fellesskapet
        reaktiveres.
      </p>
      <FormMessage state={suspendState.status === "ok" ? suspendState : idleState} />
      <Button type="button" variant="secondary" className="text-rust" onClick={() => setOpen(true)}>
        Suspender fellesskapet
      </Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} labelledBy={titleId} trapFocus>
        <form action={suspend} className="space-y-4" noValidate>
          <input type="hidden" name="communityId" value={community.id} />
          <h2 id={titleId} className="font-display text-lg text-ink">
            Suspendere {community.name}?
          </h2>
          <p className="text-sm text-ink-2">Alle medlemmer mister tilgangen med en gang. Det kan reverseres.</p>
          <Field id="suspend-reason" label="Begrunnelse" hint="Intern. Lagres i aktivitetsloggen, vises ikke for medlemmene." error={suspendState.fields?.reason}>
            <textarea id="suspend-reason" name="reason" rows={3} maxLength={1000} required className={textareaClass} />
          </Field>
          <Field id="suspend-confirm" label={`Skriv ${community.id} for å bekrefte`} error={suspendState.fields?.confirm}>
            <input id="suspend-confirm" name="confirm" autoComplete="off" spellCheck={false} autoCapitalize="none" className={`${inputClass} font-mono`} />
          </Field>
          <FormMessage state={suspendState.status === "error" ? suspendState : idleState} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Avbryt
            </Button>
            <Button type="submit" disabled={suspending} className="bg-rust hover:bg-rust/90">
              {suspending ? "Suspenderer …" : "Suspender"}
            </Button>
          </div>
        </form>
      </ConfirmDialog>
    </div>
  );
}
