"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  startMfaEnrollmentAction,
  verifyMfaAction,
  verifyMfaEnrollmentAction,
  type MfaState,
} from "@/app/platform-admin/mfa-actions";
import { Wordmark } from "@/components/shell/Wordmark";
import { IconShield } from "@/components/ui/icons";
import { Button, Panel } from "@/components/ui/primitives";

const idle: MfaState = { status: "idle" };

function CodeField({ id }: { id: string }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        Engangskode
      </label>
      <input
        id={id}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]{6,7}"
        maxLength={7}
        required
        autoFocus
        className="mt-1.5 h-11 w-40 rounded-[5px] border border-line-2 bg-surface px-3 text-lg tracking-[0.3em] text-ink"
      />
      <p className="mt-1 text-xs text-ink-3">Seks sifre fra autentiseringsappen.</p>
    </div>
  );
}

function ErrorLine({ state }: { state: MfaState }) {
  if (state.status !== "error") return null;
  return (
    <p role="alert" className="mt-3 rounded-[5px] border border-[#e7cec4] bg-rust-soft px-3 py-2 text-sm text-rust">
      {state.message}
    </p>
  );
}

/**
 * Verifying (or first setting up) the second factor. Shown instead of the
 * dashboard to an operator whose session is not at AAL2, and inline wherever
 * an owner needs a fresh verification. The rule itself is the database's.
 */
export function MfaVerifyForm({ submitLabel = "Bekreft", onVerified }: { submitLabel?: string; onVerified?: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(verifyMfaAction, idle);
  useEffect(() => {
    if (state.status === "verified") {
      onVerified?.();
      router.refresh();
    }
  }, [state, router, onVerified]);
  return (
    <form action={action} className="space-y-4">
      <CodeField id="mfa-code" />
      <ErrorLine state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Bekrefter …" : submitLabel}
      </Button>
    </form>
  );
}

function Enrollment() {
  const router = useRouter();
  const [setup, setSetup] = useState<MfaState>(idle);
  const [starting, startTransition] = useTransition();
  const [state, action, pending] = useActionState(verifyMfaEnrollmentAction, idle);

  useEffect(() => {
    if (state.status === "verified") router.refresh();
  }, [state, router]);

  if (setup.status !== "enrolling") {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-2">
          Plattformadministrasjon krever tofaktorinnlogging. Du trenger en autentiseringsapp på telefonen, for
          eksempel 1Password, Bitwarden, Google Authenticator eller Microsoft Authenticator.
        </p>
        <ErrorLine state={setup} />
        <Button
          type="button"
          disabled={starting}
          onClick={() => startTransition(async () => setSetup(await startMfaEnrollmentAction()))}
        >
          {starting ? "Starter …" : "Sett opp autentiseringsapp"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-ink-2">
        <li>Skann koden med autentiseringsappen.</li>
        <li>Skriv inn koden appen viser.</li>
      </ol>
      <div className="flex flex-col items-start gap-4 sm:flex-row">
        {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URL from Supabase Auth */}
        <img src={setup.qrCode} alt="QR-kode for autentiseringsappen" width={176} height={176} className="rounded-[6px] border border-line bg-white p-2" />
        <div className="min-w-0 text-sm">
          <p className="text-ink-2">Kan du ikke skanne? Skriv inn denne nøkkelen:</p>
          <code className="mt-1 block break-all rounded-[4px] bg-paper-2 px-2 py-1 font-mono text-[13px] text-ink">
            {setup.secret}
          </code>
        </div>
      </div>
      <form action={action} className="space-y-4">
        <input type="hidden" name="factorId" value={setup.factorId} />
        <CodeField id="mfa-enroll-code" />
        <ErrorLine state={state} />
        <Button type="submit" disabled={pending}>
          {pending ? "Bekrefter …" : "Bekreft og fortsett"}
        </Button>
      </form>
    </div>
  );
}

export function MfaGate({ hasFactor, email }: { hasFactor: boolean; email: string }) {
  return (
    <main className="flex min-h-dvh flex-col bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center px-5 py-4">
          <Wordmark size="app" />
        </div>
      </header>
      <div className="mx-auto w-full max-w-lg flex-1 px-5 py-14">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-skog-soft text-skog">
          <IconShield />
        </span>
        <h1 className="mt-4 font-display text-[1.75rem] leading-tight text-ink">
          {hasFactor ? "Bekreft at det er deg" : "Sett opp tofaktorinnlogging"}
        </h1>
        <p className="mt-2 text-sm text-ink-3">Innlogget som {email}</p>
        <Panel className="mt-6 p-5">{hasFactor ? <MfaVerifyForm /> : <Enrollment />}</Panel>
      </div>
    </main>
  );
}
