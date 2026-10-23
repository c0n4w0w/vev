"use server";

import { revalidatePath } from "next/cache";
import { getPlatformAccess } from "@/lib/platform/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The second factor for platform operators: TOTP through Supabase Auth.
 *
 * Only an account that is an operator gets this far — anyone else is refused
 * before Supabase is asked anything. Enrolment and verification are Supabase
 * Auth's own (`auth.mfa.*`); TING stores no secret and checks no code itself.
 * A successful verification gives the session AAL2 and records the moment in
 * its `amr` claim, which is what the database reads (platform_require), so a
 * new verification is also how an owner refreshes the ten-minute window for
 * privilege changes.
 */

export type MfaState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "enrolling"; factorId: string; qrCode: string; secret: string }
  | { status: "verified" };

const NOT_AN_OPERATOR: MfaState = { status: "error", message: "Du har ikke tilgang til plattformadministrasjonen." };

function codeFrom(formData: FormData): string | null {
  const code = String(formData.get("code") ?? "").replace(/\s+/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

export async function startMfaEnrollmentAction(): Promise<MfaState> {
  const access = await getPlatformAccess();
  if (!access) return NOT_AN_OPERATOR;
  if (access.hasFactor) return { status: "error", message: "Kontoen har allerede en autentiseringsapp. Skriv inn koden fra den." };

  const supabase = await createSupabaseServerClient();
  // An enrolment someone started and never finished would block a new one
  // with the same name; unverified factors give no access and are removed.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: "TING",
    friendlyName: `TING plattform ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data) {
    console.error(`[platform-admin] mfa enroll: ${error?.message ?? "ingen data"}`);
    return { status: "error", message: "Kunne ikke starte oppsettet. Er tofaktor aktivert i Supabase-prosjektet?" };
  }
  return { status: "enrolling", factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyMfaEnrollmentAction(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const access = await getPlatformAccess();
  if (!access) return NOT_AN_OPERATOR;
  const factorId = String(formData.get("factorId") ?? "");
  const code = codeFrom(formData);
  if (!code) return { status: "error", message: "Koden er seks sifre." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { status: "error", message: "Koden stemte ikke. Sjekk at klokken på telefonen er riktig, og prøv igjen." };
  revalidatePath("/platform-admin", "layout");
  return { status: "verified" };
}

/** Verifies with the account's existing factor: to reach AAL2, or to refresh the window. */
export async function verifyMfaAction(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const access = await getPlatformAccess();
  if (!access) return NOT_AN_OPERATOR;
  const code = codeFrom(formData);
  if (!code) return { status: "error", message: "Koden er seks sifre." };

  const supabase = await createSupabaseServerClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.find((entry) => entry.status === "verified");
  if (listError || !factor) return { status: "error", message: "Fant ingen autentiseringsapp på kontoen." };

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { status: "error", message: "Koden stemte ikke. Prøv igjen med en ny kode." };
  revalidatePath("/platform-admin", "layout");
  return { status: "verified" };
}
