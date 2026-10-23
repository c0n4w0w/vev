"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createCommunityAction } from "@/app/platform-admin/actions";
import { Field, FormMessage, PlatformMark, inputClass, textareaClass } from "@/components/platform/ui";
import { Button, cn } from "@/components/ui/primitives";
import { IconCheck } from "@/components/ui/icons";
import {
  ACCENT_PRESETS,
  ACCESS_POLICY_LABELS,
  DIRECTORY_LABELS,
  DM_POLICY_LABELS,
  LOCALE_LABELS,
  MARK_STYLE_LABELS,
  contrastWithWhite,
  identifierProblem,
  idleState,
  isHexColor,
  type PlatformFormState,
  looksLikeEmail,
  suggestIdentifier,
  suggestMonogram,
} from "@/lib/platform/forms";

const STEPS = ["Organisasjon", "Profil", "Utseende", "Tilgang", "Administrator", "Oppsummering"] as const;

/** Which step each field lives on, so a server-side problem opens the right one. */
const FIELD_STEP: Record<string, number> = {
  name: 0, id: 0, slug: 0,
  tagline: 1, publicDescription: 1, location: 1, foundedYear: 1,
  accent: 2, monogram: 2, markStyle: 2, logo: 2,
  accessPolicy: 3, memberDirectoryVisibility: 3, dmPolicy: 3, defaultLocale: 3,
  adminEmail: 4,
};

export interface WizardPrefill {
  requestId?: string;
  name?: string;
  adminEmail?: string;
  requestLabel?: string;
}

export function CreateCommunityWizard({ creationKey, prefill }: { creationKey: string; prefill: WizardPrefill }) {
  const [step, setStep] = useState(0);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  // A refusal from the server opens the step with the first problem.
  const [state, action, pending] = useActionState(async (previous: PlatformFormState, formData: FormData) => {
    const next = await createCommunityAction(previous, formData);
    const steps = Object.keys(next.fields ?? {})
      .map((field) => FIELD_STEP[field])
      .filter((value) => value !== undefined);
    if (steps.length) setStep(Math.min(...steps));
    setLocalErrors({});
    return next;
  }, idleState);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [name, setName] = useState(prefill.name ?? "");
  const [id, setId] = useState(() => suggestIdentifier(prefill.name ?? ""));
  const [idTouched, setIdTouched] = useState(false);
  const [slug, setSlug] = useState(() => suggestIdentifier(prefill.name ?? ""));
  const [slugTouched, setSlugTouched] = useState(false);
  const [tagline, setTagline] = useState("");
  const [publicDescription, setPublicDescription] = useState("");
  const [location, setLocation] = useState("");
  const [foundedYear, setFoundedYear] = useState(String(new Date().getFullYear()));
  const [accent, setAccent] = useState<string>(ACCENT_PRESETS[0].value);
  const [monogram, setMonogram] = useState(() => suggestMonogram(prefill.name ?? ""));
  const [monogramTouched, setMonogramTouched] = useState(false);
  const [markStyle, setMarkStyle] = useState<"sans" | "serif" | "mono">("sans");
  const [logoName, setLogoName] = useState<string | null>(null);
  const [accessPolicy, setAccessPolicy] = useState<keyof typeof ACCESS_POLICY_LABELS>("invite-only");
  const [directory, setDirectory] = useState<keyof typeof DIRECTORY_LABELS>("admin_only");
  const [dmPolicy, setDmPolicy] = useState<keyof typeof DM_POLICY_LABELS>("staff_only");
  const [locale, setLocale] = useState<keyof typeof LOCALE_LABELS>("nb");
  const [adminEmail, setAdminEmail] = useState(prefill.adminEmail ?? "");

  const errors = { ...(state.fields ?? {}), ...localErrors };

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  function onName(value: string) {
    setName(value);
    if (!idTouched) setId(suggestIdentifier(value));
    if (!slugTouched) setSlug(suggestIdentifier(value));
    if (!monogramTouched) setMonogram(suggestMonogram(value));
  }

  function validate(index: number): Record<string, string> {
    const problems: Record<string, string> = {};
    if (index === 0) {
      if (name.trim().length < 2 || name.trim().length > 80) problems.name = "Mellom 2 og 80 tegn.";
      const idProblem = identifierProblem(id);
      if (idProblem) problems.id = idProblem;
      const slugProblem = identifierProblem(slug);
      if (slugProblem) problems.slug = slugProblem;
    }
    if (index === 1) {
      const year = Number(foundedYear);
      if (!/^\d{4}$/.test(foundedYear) || year < 1800 || year > new Date().getFullYear()) {
        problems.foundedYear = `Et årstall mellom 1800 og ${new Date().getFullYear()}.`;
      }
      if (tagline.length > 140) problems.tagline = "Høyst 140 tegn.";
      if (publicDescription.length > 1000) problems.publicDescription = "Høyst 1000 tegn.";
      if (location.length > 80) problems.location = "Høyst 80 tegn.";
    }
    if (index === 2) {
      if (!isHexColor(accent)) problems.accent = "En farge som #1f4a3d.";
      if (!/^[A-ZÆØÅ0-9]{1,3}$/.test(monogram)) problems.monogram = "Én til tre bokstaver eller tall.";
    }
    if (index === 4 && adminEmail && !looksLikeEmail(adminEmail.trim())) {
      problems.adminEmail = "Ikke en gyldig e-postadresse.";
    }
    return problems;
  }

  function next() {
    const problems = validate(step);
    setLocalErrors(problems);
    if (Object.keys(problems).length === 0) setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  const lowContrast = useMemo(() => contrastWithWhite(accent) < 4.5, [accent]);
  const visible = (index: number) => (index === step ? undefined : true);

  return (
    <form action={action} noValidate className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]" aria-describedby="wizard-status">
      <input type="hidden" name="creationKey" value={creationKey} />
      {prefill.requestId ? <input type="hidden" name="requestId" value={prefill.requestId} /> : null}

      <nav aria-label="Steg">
        <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible">
          {STEPS.map((label, index) => (
            <li key={label} className="shrink-0">
              <button
                type="button"
                onClick={() => {
                  // Going back is always allowed; forward only through validation.
                  if (index <= step) setStep(index);
                  else if (index === step + 1) next();
                }}
                aria-current={index === step ? "step" : undefined}
                className={cn(
                  "flex min-h-9 w-full items-center gap-2 rounded-[5px] px-3 text-left text-sm",
                  index === step ? "bg-skog-soft font-medium text-skog" : index < step ? "text-ink-2 hover:bg-paper-2" : "text-ink-3",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                    index < step ? "border-skog bg-skog text-white" : "border-line-2",
                  )}
                  aria-hidden="true"
                >
                  {index < step ? <IconCheck size={12} /> : index + 1}
                </span>
                {label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="min-w-0 rounded-[6px] border border-line bg-surface p-5 sm:p-6">
        <h2 ref={headingRef} tabIndex={-1} className="font-display text-xl text-ink outline-none">
          {STEPS[step]}
        </h2>
        {prefill.requestLabel ? (
          <p className="mt-1 text-sm text-ink-3">Fra forespørselen: {prefill.requestLabel}</p>
        ) : null}

        <div className="mt-5 space-y-5">
          {/* 1. Organisation */}
          <fieldset hidden={visible(0)} className="space-y-5">
            <legend className="sr-only">Organisasjon</legend>
            <Field id="name" label="Navn på organisasjonen" error={errors.name} hint="Slik navnet vises for medlemmene og på portalen.">
              <input id="name" name="name" value={name} onChange={(event) => onName(event.target.value)} maxLength={80} className={inputClass} aria-invalid={Boolean(errors.name)} autoComplete="organization" />
            </Field>
            <Field id="id" label="Identifikator" error={errors.id} hint="Fast intern nøkkel i adressen /community/…. Kan ikke endres senere.">
              <input
                id="id"
                name="id"
                value={id}
                onChange={(event) => {
                  setIdTouched(true);
                  setId(event.target.value.toLowerCase());
                }}
                maxLength={50}
                className={`${inputClass} font-mono`}
                aria-invalid={Boolean(errors.id)}
                spellCheck={false}
                autoCapitalize="none"
              />
            </Field>
            <Field id="slug" label="Portaladresse" error={errors.slug} hint={`Den offentlige portalen: join-ting.no/${slug || "…"}`}>
              <input
                id="slug"
                name="slug"
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value.toLowerCase());
                }}
                maxLength={50}
                className={`${inputClass} font-mono`}
                aria-invalid={Boolean(errors.slug)}
                spellCheck={false}
                autoCapitalize="none"
              />
            </Field>
          </fieldset>

          {/* 2. Profile */}
          <fieldset hidden={visible(1)} className="space-y-5">
            <legend className="sr-only">Profil</legend>
            <Field id="tagline" label="Kort beskrivelse" optional error={errors.tagline} hint="Én linje, høyst 140 tegn.">
              <input id="tagline" name="tagline" value={tagline} onChange={(event) => setTagline(event.target.value)} maxLength={140} className={inputClass} aria-invalid={Boolean(errors.tagline)} />
            </Field>
            <Field id="publicDescription" label="Offentlig beskrivelse" optional error={errors.publicDescription} hint="Vises på den offentlige portalen. Fellesskapets administrator kan endre den senere.">
              <textarea id="publicDescription" name="publicDescription" value={publicDescription} onChange={(event) => setPublicDescription(event.target.value)} maxLength={1000} rows={4} className={textareaClass} aria-invalid={Boolean(errors.publicDescription)} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="location" label="Sted" optional error={errors.location}>
                <input id="location" name="location" value={location} onChange={(event) => setLocation(event.target.value)} maxLength={80} placeholder="For eksempel Oslo eller Landsdekkende" className={inputClass} aria-invalid={Boolean(errors.location)} />
              </Field>
              <Field id="foundedYear" label="Etablert år" error={errors.foundedYear}>
                <input id="foundedYear" name="foundedYear" value={foundedYear} onChange={(event) => setFoundedYear(event.target.value)} inputMode="numeric" maxLength={4} className={inputClass} aria-invalid={Boolean(errors.foundedYear)} />
              </Field>
            </div>
          </fieldset>

          {/* 3. Appearance */}
          <fieldset hidden={visible(2)} className="space-y-5">
            <legend className="sr-only">Utseende</legend>
            <div>
              <p id="accent-label" className="text-sm font-medium text-ink">Farge</p>
              <div role="radiogroup" aria-labelledby="accent-label" className="mt-2 flex flex-wrap gap-2">
                {ACCENT_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    role="radio"
                    aria-checked={accent === preset.value}
                    onClick={() => setAccent(preset.value)}
                    className={cn("h-9 w-9 rounded-full border-2", accent === preset.value ? "border-ink" : "border-transparent")}
                    style={{ backgroundColor: preset.value }}
                    title={preset.label}
                  >
                    <span className="sr-only">{preset.label}</span>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <input type="color" aria-label="Velg egen farge" value={isHexColor(accent) ? accent : "#1f4a3d"} onChange={(event) => setAccent(event.target.value.toLowerCase())} className="h-10 w-12 cursor-pointer rounded-[5px] border border-line-2 bg-surface" />
                <input id="accent" name="accent" value={accent} onChange={(event) => setAccent(event.target.value.toLowerCase())} maxLength={7} className={`${inputClass} w-32 font-mono`} aria-label="Fargekode" aria-invalid={Boolean(errors.accent)} />
              </div>
              {errors.accent ? <p className="mt-1 text-xs text-rust">{errors.accent}</p> : null}
              {lowContrast && isHexColor(accent) ? (
                <p className="mt-1 text-xs text-rust">Hvit tekst blir vanskelig å lese på denne fargen. Velg en mørkere farge.</p>
              ) : null}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="monogram" label="Monogram" error={errors.monogram} hint="Én til tre tegn, brukt når det ikke er lastet opp logo.">
                <input
                  id="monogram"
                  name="monogram"
                  value={monogram}
                  onChange={(event) => {
                    setMonogramTouched(true);
                    setMonogram(event.target.value.toUpperCase());
                  }}
                  maxLength={3}
                  className={`${inputClass} w-28 uppercase`}
                  aria-invalid={Boolean(errors.monogram)}
                />
              </Field>
              <Field id="markStyle" label="Skrift i monogrammet">
                <select id="markStyle" name="markStyle" value={markStyle} onChange={(event) => setMarkStyle(event.target.value as typeof markStyle)} className={inputClass}>
                  {Object.entries(MARK_STYLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field id="logo" label="Logo" optional hint={logoName ? `Valgt: ${logoName}` : "PNG, JPEG eller WebP, kvadratisk, minst 64 × 64 piksler og høyst 5 MB."}>
              <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setLogoName(event.target.files?.[0]?.name ?? null)} className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-[5px] file:border file:border-line-2 file:bg-surface file:px-3 file:py-2 file:text-sm" />
            </Field>
            <div className="flex items-center gap-3 rounded-[6px] border border-line bg-paper px-4 py-3">
              <PlatformMark accent={isHexColor(accent) ? accent : "#1f4a3d"} monogram={monogram || "?"} markStyle={markStyle} size="lg" />
              <div>
                <p className="font-medium text-ink">{name || "Organisasjonens navn"}</p>
                <p className="text-sm text-ink-3">{tagline || "Kort beskrivelse"}</p>
              </div>
            </div>
          </fieldset>

          {/* 4. Access and defaults */}
          <fieldset hidden={visible(3)} className="space-y-5">
            <legend className="sr-only">Tilgang og standardvalg</legend>
            <p className="text-sm text-ink-2">De strengeste valgene er forhåndsvalgt. Fellesskapets administrator kan endre flere av dem selv senere.</p>
            <Field id="accessPolicy" label="Hvordan nye medlemmer kommer inn">
              <select id="accessPolicy" name="accessPolicy" value={accessPolicy} onChange={(event) => setAccessPolicy(event.target.value as typeof accessPolicy)} className={inputClass}>
                {Object.entries(ACCESS_POLICY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field id="memberDirectoryVisibility" label="Medlemslisten">
              <select id="memberDirectoryVisibility" name="memberDirectoryVisibility" value={directory} onChange={(event) => setDirectory(event.target.value as typeof directory)} className={inputClass}>
                {Object.entries(DIRECTORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field id="dmPolicy" label="Direktemeldinger">
              <select id="dmPolicy" name="dmPolicy" value={dmPolicy} onChange={(event) => setDmPolicy(event.target.value as typeof dmPolicy)} className={inputClass}>
                {Object.entries(DM_POLICY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field id="defaultLocale" label="Språk i fellesskapet">
              <select id="defaultLocale" name="defaultLocale" value={locale} onChange={(event) => setLocale(event.target.value as typeof locale)} className={inputClass}>
                {Object.entries(LOCALE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
          </fieldset>

          {/* 5. Administrator */}
          <fieldset hidden={visible(4)} className="space-y-5">
            <legend className="sr-only">Første administrator</legend>
            <Field id="adminEmail" label="E-postadressen til fellesskapets administrator" optional error={errors.adminEmail}>
              <input id="adminEmail" name="adminEmail" type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} autoComplete="off" className={inputClass} aria-invalid={Boolean(errors.adminEmail)} />
            </Field>
            <div className="rounded-[6px] border border-line bg-paper px-4 py-3 text-sm leading-relaxed text-ink-2">
              <p>
                Har adressen en TING-konto med bekreftet adresse og passord, blir personen administrator med en gang og får beskjed på e-post.
              </p>
              <p className="mt-2">
                Ellers sendes en invitasjon. Den kan bare tas i bruk av den som logger inn med akkurat denne adressen, og personen blir administrator først da.
              </p>
              <p className="mt-2 text-ink-3">Uten adresse opprettes fellesskapet uten administrator. Du kan utnevne en senere.</p>
            </div>
          </fieldset>

          {/* 6. Summary */}
          <div hidden={visible(5)}>
            <dl className="divide-y divide-line rounded-[6px] border border-line text-sm">
              {[
                ["Navn", name],
                ["Identifikator", id],
                ["Portal", `/${slug}`],
                ["Etablert", foundedYear],
                ["Tilgang", ACCESS_POLICY_LABELS[accessPolicy]],
                ["Medlemsliste", DIRECTORY_LABELS[directory]],
                ["Direktemeldinger", DM_POLICY_LABELS[dmPolicy]],
                ["Språk", LOCALE_LABELS[locale]],
                ["Logo", logoName ?? "Ingen (monogram)"],
                ["Administrator", adminEmail.trim() || "Utnevnes senere"],
              ].map(([term, value]) => (
                <div key={term} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <dt className="text-ink-3">{term}</dt>
                  <dd className="break-words text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm text-ink-2">
              Fellesskapet opprettes uten kanaler, innlegg og medlemmer. Administratoren setter det opp selv. Ingen plattformadministrator blir medlem.
            </p>
          </div>
        </div>

        <div id="wizard-status" className="mt-6 space-y-4">
          <FormMessage state={state.status === "error" && Object.keys(localErrors).length === 0 ? state : idleState} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <Button type="button" variant="ghost" onClick={() => setStep((current) => Math.max(current - 1, 0))} disabled={step === 0 || pending}>
              Tilbake
            </Button>
            {/* Separate keys: the same DOM button switching to type="submit"
                during the click that reached the last step would submit the
                form before the summary was ever shown. */}
            {step < STEPS.length - 1 ? (
              <Button key="next" type="button" onClick={next}>
                Neste
              </Button>
            ) : (
              <Button key="submit" type="submit" disabled={pending}>
                {pending ? "Oppretter …" : "Opprett fellesskapet"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
