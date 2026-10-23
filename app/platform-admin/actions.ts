"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { inspectCommunityAvatar } from "@/lib/community-avatar-image";
import { getPlatformAccess } from "@/lib/platform/access";
import { getPlatformCommunity } from "@/lib/platform/data";
import { messageFor, platformErrorCode, platformErrorMessage, type DatabaseError } from "@/lib/platform/errors";
import {
  identifierProblem,
  isHexColor,
  looksLikeEmail,
  softAccent,
  type PlatformFormState,
} from "@/lib/platform/forms";
import { sendAdminAppointmentEmail } from "@/lib/platform/invitation-email";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Server actions for /platform-admin.
 *
 * The order is the same everywhere:
 *
 * 1. `operator()` asks the database who the caller is. Not an operator, or no
 *    verified second factor: nothing else runs. This is for a clear answer,
 *    not the rule.
 * 2. The input is validated here for field-level messages.
 * 3. The platform database function runs as the signed-in operator and
 *    decides for itself — authorisation (platform_require), the same input
 *    rules, the target's state — and writes the audit entry in the same
 *    transaction as the change.
 * 4. A refusal from an authorised operator is recorded as a failed attempt
 *    (platform_record_failure), and answered with a fixed Norwegian sentence.
 *    Database text never reaches the browser.
 *
 * No action takes an operator id, role or "is owner" flag from the form.
 */

type Enums = Database["public"]["Enums"];

const FORBIDDEN: PlatformFormState = { status: "error", message: messageFor("platform-forbidden") };

async function operator() {
  const access = await getPlatformAccess();
  if (!access) return null;
  if (!access.mfaVerified) return { access, supabase: null };
  return { access, supabase: await createSupabaseServerClient() };
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function refuse(
  supabase: Supabase,
  error: DatabaseError,
  audit: { action: string; targetType: string; targetId?: string | null },
): Promise<PlatformFormState> {
  const code = platformErrorCode(error);
  // Refusals that mean "who are you" are not an operator's failed attempt.
  if (code !== "platform-forbidden") {
    const { error: logError } = await supabase.rpc("platform_record_failure", {
      p_action: audit.action,
      p_target_type: audit.targetType,
      p_target_id: audit.targetId ?? "",
      p_reason: (code ?? "unexpected").slice(0, 60),
    });
    if (logError) console.error(`[platform-admin] platform_record_failure: ${logError.code} ${logError.message}`);
  }
  return { status: "error", message: platformErrorMessage(error, audit.action) };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

const COMMUNITY_ID = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function enumValue<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

interface CommunityFields {
  slug: string;
  name: string;
  tagline: string;
  publicDescription: string;
  location: string;
  foundedYear: number;
  accent: string;
  accentSoft: string;
  monogram: string;
  markStyle: "sans" | "serif" | "mono";
  accessPolicy: Enums["access_policy"];
  defaultLocale: "nb" | "en";
  memberDirectoryVisibility: Enums["member_directory_visibility"];
  dmPolicy: Enums["dm_policy"];
}

/**
 * The community fields both forms share. Secure defaults when a value is
 * missing: invitation only, member list for the administrator only, direct
 * messages only to staff who accept them.
 */
function readCommunityFields(formData: FormData): { fields: CommunityFields; problems: Record<string, string> } {
  const problems: Record<string, string> = {};
  const slug = text(formData, "slug").toLowerCase();
  const name = text(formData, "name");
  const tagline = text(formData, "tagline");
  const publicDescription = text(formData, "publicDescription");
  const location = text(formData, "location");
  const yearText = text(formData, "foundedYear");
  const foundedYear = Number(yearText);
  const accent = text(formData, "accent").toLowerCase();
  const monogram = text(formData, "monogram").toUpperCase();

  const slugProblem = identifierProblem(slug);
  if (slugProblem) problems.slug = slugProblem;
  if (name.length < 2 || name.length > 80) problems.name = "Mellom 2 og 80 tegn.";
  if (tagline.length > 140) problems.tagline = "Høyst 140 tegn.";
  if (publicDescription.length > 1000) problems.publicDescription = "Høyst 1000 tegn.";
  if (location.length > 80) problems.location = "Høyst 80 tegn.";
  if (!/^\d{4}$/.test(yearText) || foundedYear < 1800 || foundedYear > new Date().getFullYear()) {
    problems.foundedYear = `Et årstall mellom 1800 og ${new Date().getFullYear()}.`;
  }
  if (!isHexColor(accent)) problems.accent = "En farge som #1f4a3d.";
  if (!/^[A-ZÆØÅ0-9]{1,3}$/.test(monogram)) problems.monogram = "Én til tre bokstaver eller tall.";

  return {
    problems,
    fields: {
      slug,
      name,
      tagline,
      publicDescription,
      location,
      foundedYear,
      accent,
      accentSoft: softAccent(accent),
      monogram,
      markStyle: enumValue(text(formData, "markStyle"), ["sans", "serif", "mono"] as const, "sans"),
      accessPolicy: enumValue(text(formData, "accessPolicy"), ["invite-only", "request-to-join"] as const, "invite-only"),
      defaultLocale: enumValue(text(formData, "defaultLocale"), ["nb", "en"] as const, "nb"),
      memberDirectoryVisibility: enumValue(
        text(formData, "memberDirectoryVisibility"),
        ["admin_only", "members"] as const,
        "admin_only",
      ),
      dmPolicy: enumValue(text(formData, "dmPolicy"), ["staff_only", "members"] as const, "staff_only"),
    },
  };
}

function readLogo(formData: FormData): { file: File | null; problem?: string } {
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { file: null };
  return { file };
}

/**
 * Stores a logo for a community. The object is written with the service role
 * only after the operator check above passed, then
 * platform_set_community_avatar() — which authorises again — points the
 * community at it. If that refuses, the object is removed again.
 */
async function storeLogo(supabase: Supabase, communityId: string, file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = inspectCommunityAvatar(bytes);
  if (!image.ok) return image.error;

  const storage = createSupabaseAdminClient().storage.from("community-avatars");
  const path = `${communityId}/${crypto.randomUUID()}.${image.extension}`;
  const { error: uploadError } = await storage.upload(path, bytes, { contentType: image.contentType, upsert: false });
  if (uploadError) {
    console.error(`[platform-admin] logo upload: ${uploadError.message}`);
    return "Logoen kunne ikke lagres. Prøv igjen.";
  }

  const { data, error } = await supabase.rpc("platform_set_community_avatar", { p_community_id: communityId, p_path: path });
  if (error || !data?.[0]?.applied) {
    await storage.remove([path]);
    return platformErrorMessage(error, "platform_set_community_avatar");
  }
  const previous = data[0].previous_path;
  if (previous && previous !== path) await storage.remove([previous]);
  return null;
}

// ── Communities ─────────────────────────────────────────────────────────

export async function createCommunityAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const op = await operator();
  if (!op) return FORBIDDEN;
  if (!op.supabase) return { status: "error", message: messageFor("platform-mfa-required") };
  const { supabase } = op;

  const { fields, problems } = readCommunityFields(formData);
  const id = text(formData, "id").toLowerCase();
  const idProblem = identifierProblem(id);
  if (idProblem) problems.id = idProblem;
  const adminEmail = text(formData, "adminEmail").toLowerCase();
  if (adminEmail && !looksLikeEmail(adminEmail)) problems.adminEmail = "Ikke en gyldig e-postadresse.";
  const creationKey = text(formData, "creationKey");
  const requestId = text(formData, "requestId");
  const logo = readLogo(formData);

  if (!UUID.test(creationKey) || (requestId && !UUID.test(requestId))) {
    return { status: "error", message: "Skjemaet er ugyldig. Last siden på nytt." };
  }
  if (Object.keys(problems).length > 0) {
    return { status: "error", message: "Se over feltene som er markert.", fields: problems };
  }

  const { data, error } = await supabase.rpc("platform_create_community", {
    p_id: id,
    p_slug: fields.slug,
    p_name: fields.name,
    p_tagline: fields.tagline,
    p_public_description: fields.publicDescription,
    p_location: fields.location,
    p_founded_year: fields.foundedYear,
    p_accent: fields.accent,
    p_accent_soft: fields.accentSoft,
    p_monogram: fields.monogram,
    p_mark_style: fields.markStyle,
    p_access_policy: fields.accessPolicy,
    p_default_locale: fields.defaultLocale,
    p_member_directory_visibility: fields.memberDirectoryVisibility,
    p_dm_policy: fields.dmPolicy,
    p_admin_email: adminEmail,
    // JSON null reaches the function as SQL null: no request.
    p_onboarding_request_id: (requestId || null) as string,
    p_creation_key: creationKey,
  });

  if (error) {
    const refused = await refuse(supabase, error, { action: "community.create", targetType: "community", targetId: id });
    const code = platformErrorCode(error);
    if (code === "id-taken") refused.fields = { id: refused.message ?? "" };
    if (code === "slug-taken") refused.fields = { slug: refused.message ?? "" };
    return refused;
  }

  const row = data?.[0];
  if (!row) return { status: "error", message: messageFor("unexpected") };
  revalidatePath("/platform-admin", "layout");

  // The same form sent twice: the first submission already did everything.
  if (!row.created) redirect(`/platform-admin/fellesskap/${row.community_id}?opprettet=1`);

  const notes: string[] = [];
  if (row.admin_outcome === "invited" || row.admin_outcome === "assigned") {
    const sent = await sendAdminAppointmentEmail({
      kind: row.admin_outcome === "invited" ? "new" : "existing",
      token: row.admin_token ?? null,
      email: row.admin_email ?? adminEmail,
      expiresAt: row.admin_expires_at ?? null,
      community: { id: row.community_id, name: fields.name, slug: row.slug, locale: fields.defaultLocale, accent: fields.accent },
    });
    if (!sent.ok) notes.push("epost");
  }

  if (logo.file) {
    const problem = await storeLogo(supabase, row.community_id, logo.file);
    if (problem) notes.push("logo");
  }

  const query = new URLSearchParams({ opprettet: "1" });
  if (row.admin_outcome) query.set("administrator", row.admin_outcome);
  if (notes.length) query.set("merknad", notes.join(","));
  redirect(`/platform-admin/fellesskap/${row.community_id}?${query}`);
}

export async function updateCommunityAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const op = await operator();
  if (!op) return FORBIDDEN;
  if (!op.supabase) return { status: "error", message: messageFor("platform-mfa-required") };
  const { supabase } = op;

  const communityId = text(formData, "communityId");
  if (!COMMUNITY_ID.test(communityId)) return { status: "error", message: messageFor("community-not-found") };
  const { fields, problems } = readCommunityFields(formData);
  if (Object.keys(problems).length > 0) {
    return { status: "error", message: "Se over feltene som er markert.", fields: problems };
  }

  const { data, error } = await supabase.rpc("platform_update_community", {
    p_community_id: communityId,
    p_slug: fields.slug,
    p_name: fields.name,
    p_tagline: fields.tagline,
    p_public_description: fields.publicDescription,
    p_location: fields.location,
    p_founded_year: fields.foundedYear,
    p_accent: fields.accent,
    p_accent_soft: fields.accentSoft,
    p_monogram: fields.monogram,
    p_mark_style: fields.markStyle,
    p_access_policy: fields.accessPolicy,
    p_default_locale: fields.defaultLocale,
    p_member_directory_visibility: fields.memberDirectoryVisibility,
    p_dm_policy: fields.dmPolicy,
  });
  if (error) {
    const refused = await refuse(supabase, error, { action: "community.update", targetType: "community", targetId: communityId });
    if (platformErrorCode(error) === "slug-taken") refused.fields = { slug: refused.message ?? "" };
    return refused;
  }

  revalidatePath("/platform-admin", "layout");
  return { status: "ok", message: data ? "Endringene er lagret." : "Ingenting var endret." };
}

export async function setCommunityLogoAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const op = await operator();
  if (!op) return FORBIDDEN;
  if (!op.supabase) return { status: "error", message: messageFor("platform-mfa-required") };
  const communityId = text(formData, "communityId");
  if (!COMMUNITY_ID.test(communityId)) return { status: "error", message: messageFor("community-not-found") };
  const logo = readLogo(formData);
  if (!logo.file) return { status: "error", message: "Velg en bildefil (PNG, JPEG eller WebP)." };
  const problem = await storeLogo(op.supabase, communityId, logo.file);
  if (problem) return { status: "error", message: problem };
  revalidatePath("/platform-admin", "layout");
  revalidatePath("/", "layout");
  return { status: "ok", message: "Logoen er oppdatert." };
}

export async function removeCommunityLogoAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const op = await operator();
  if (!op) return FORBIDDEN;
  if (!op.supabase) return { status: "error", message: messageFor("platform-mfa-required") };
  const communityId = text(formData, "communityId");
  if (!COMMUNITY_ID.test(communityId)) return { status: "error", message: messageFor("community-not-found") };
  const { data, error } = await op.supabase.rpc("platform_set_community_avatar", {
    p_community_id: communityId,
    p_path: null as unknown as string,
  });
  if (error) return refuse(op.supabase, error, { action: "community.update", targetType: "community", targetId: communityId });
  const previous = data?.[0]?.previous_path;
  if (previous) await createSupabaseAdminClient().storage.from("community-avatars").remove([previous]);
  revalidatePath("/platform-admin", "layout");
  revalidatePath("/", "layout");
  return { status: "ok", message: "Logoen er fjernet. Monogrammet vises i stedet." };
}

// ── Administrators ──────────────────────────────────────────────────────

export async function assignAdminAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const op = await operator();
  if (!op) return FORBIDDEN;
  if (!op.supabase) return { status: "error", message: messageFor("platform-mfa-required") };
  const { supabase } = op;

  const communityId = text(formData, "communityId");
  const email = text(formData, "email").toLowerCase();
  const replace = formData.get("replace") === "on";
  if (!COMMUNITY_ID.test(communityId)) return { status: "error", message: messageFor("community-not-found") };
  if (!looksLikeEmail(email)) return { status: "error", message: "Ikke en gyldig e-postadresse.", fields: { email: "Ikke en gyldig e-postadresse." } };

  const { data, error } = await supabase.rpc("platform_assign_community_admin", {
    p_community_id: communityId,
    p_email: email,
    p_replace: replace,
  });
  if (error) {
    return refuse(supabase, error, { action: "community.admin.assign", targetType: "community", targetId: communityId });
  }
  const row = data?.[0];
  revalidatePath("/platform-admin", "layout");
  if (!row) return { status: "error", message: messageFor("unexpected") };
  if (row.outcome === "already-admin") return { status: "ok", message: `${email} er allerede administrator.` };

  const community = await getPlatformCommunity(communityId);
  if (!community) return { status: "ok", message: "Administratoren er registrert." };
  const sent = await sendAdminAppointmentEmail({
    kind: row.outcome === "invited" ? "new" : "existing",
    token: row.token ?? null,
    email: row.email,
    expiresAt: row.expires_at ?? null,
    community: {
      id: community.id,
      name: community.name,
      slug: community.slug,
      locale: community.defaultLocale,
      accent: community.accent,
    },
  });

  if (row.outcome === "assigned") {
    return {
      status: "ok",
      message: sent.ok
        ? `${row.email} er nå administrator, og har fått beskjed på e-post.`
        : `${row.email} er nå administrator. E-posten kunne ikke sendes: ${sent.message}`,
    };
  }
  return sent.ok
    ? { status: "ok", message: `Invitasjonen er sendt til ${row.email}. Personen blir administrator når invitasjonen tas i bruk.` }
    : { status: "error", message: `Invitasjonen er opprettet, men e-posten kunne ikke sendes: ${sent.message} Send den på nytt nedenfor.` };
}

export async function removeAdminAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const op = await operator();
  if (!op) return FORBIDDEN;
  if (!op.supabase) return { status: "error", message: messageFor("platform-mfa-required") };
  const communityId = text(formData, "communityId");
  if (!COMMUNITY_ID.test(communityId)) return { status: "error", message: messageFor("community-not-found") };
  const { error } = await op.supabase.rpc("platform_remove_community_admin", { p_community_id: communityId });
  if (error) return refuse(op.supabase, error, { action: "community.admin.remove", targetType: "community", targetId: communityId });
  revalidatePath("/platform-admin", "layout");
  return { status: "ok", message: "Administratorrollen er fjernet. Personen er fortsatt medlem." };
}

export async function revokeAdminInvitationAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const op = await operator();
  if (!op) return FORBIDDEN;
  if (!op.supabase) return { status: "error", message: messageFor("platform-mfa-required") };
  const invitationId = text(formData, "invitationId");
  if (!UUID.test(invitationId)) return { status: "error", message: messageFor("invitation-not-open") };
  const { error } = await op.supabase.rpc("platform_revoke_admin_invitation", { p_invitation_id: invitationId });
  if (error) return refuse(op.supabase, error, { action: "community.admin.invitation.revoke", targetType: "invitation", targetId: invitationId });
  revalidatePath("/platform-admin", "layout");
  return { status: "ok", message: "Invitasjonen er trukket tilbake. Lenken virker ikke lenger." };
}

export async function resendAdminInvitationAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const op = await operator();
  if (!op) return FORBIDDEN;
  if (!op.supabase) return { status: "error", message: messageFor("platform-mfa-required") };
  const invitationId = text(formData, "invitationId");
  if (!UUID.test(invitationId)) return { status: "error", message: messageFor("invitation-not-open") };
  const { data, error } = await op.supabase.rpc("platform_resend_admin_invitation", { p_invitation_id: invitationId });
  if (error) return refuse(op.supabase, error, { action: "community.admin.invitation.resend", targetType: "invitation", targetId: invitationId });
  const row = data?.[0];
  revalidatePath("/platform-admin", "layout");
  if (!row) return { status: "error", message: messageFor("unexpected") };
  const community = await getPlatformCommunity(row.community_id);
  if (!community) return { status: "error", message: messageFor("community-not-found") };
  const sent = await sendAdminAppointmentEmail({
    kind: "new",
    token: row.token,
    email: row.email,
    expiresAt: row.expires_at,
    community: { id: community.id, name: community.name, slug: community.slug, locale: community.defaultLocale, accent: community.accent },
  });
  return sent.ok
    ? { status: "ok", message: `En ny invitasjon er sendt til ${row.email}. Den forrige lenken virker ikke lenger.` }
    : { status: "error", message: `En ny invitasjon er opprettet, men e-posten kunne ikke sendes: ${sent.message}` };
}

// ── Suspension ──────────────────────────────────────────────────────────

export async function suspendCommunityAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const op = await operator();
  if (!op) return FORBIDDEN;
  if (!op.supabase) return { status: "error", message: messageFor("platform-mfa-required") };
  const communityId = text(formData, "communityId");
  const reason = text(formData, "reason");
  const confirm = text(formData, "confirm");
  if (!COMMUNITY_ID.test(communityId)) return { status: "error", message: messageFor("community-not-found") };
  if (reason.length < 3 || reason.length > 1000) {
    return { status: "error", message: messageFor("invalid-reason"), fields: { reason: messageFor("invalid-reason") } };
  }
  if (confirm !== communityId) {
    return { status: "error", message: "Skriv fellesskapets identifikator for å bekrefte.", fields: { confirm: "Stemmer ikke med identifikatoren." } };
  }
  const { error } = await op.supabase.rpc("platform_suspend_community", { p_community_id: communityId, p_reason: reason });
  if (error) return refuse(op.supabase, error, { action: "community.suspend", targetType: "community", targetId: communityId });
  revalidatePath("/platform-admin", "layout");
  revalidatePath("/", "layout");
  return { status: "ok", message: "Fellesskapet er suspendert. Alt innhold er beholdt." };
}

export async function reactivateCommunityAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const op = await operator();
  if (!op) return FORBIDDEN;
  if (!op.supabase) return { status: "error", message: messageFor("platform-mfa-required") };
  const communityId = text(formData, "communityId");
  const note = text(formData, "note");
  if (!COMMUNITY_ID.test(communityId)) return { status: "error", message: messageFor("community-not-found") };
  if (note.length > 1000) return { status: "error", message: "Høyst 1000 tegn." };
  const { error } = await op.supabase.rpc("platform_reactivate_community", { p_community_id: communityId, p_note: note });
  if (error) return refuse(op.supabase, error, { action: "community.reactivate", targetType: "community", targetId: communityId });
  revalidatePath("/platform-admin", "layout");
  revalidatePath("/", "layout");
  return { status: "ok", message: "Fellesskapet er aktivt igjen." };
}

// ── Onboarding requests ─────────────────────────────────────────────────

export async function reviewRequestAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const op = await operator();
  if (!op) return FORBIDDEN;
  if (!op.supabase) return { status: "error", message: messageFor("platform-mfa-required") };
  const requestId = text(formData, "requestId");
  const decision = text(formData, "decision");
  const note = text(formData, "note");
  if (!UUID.test(requestId) || (decision !== "approved" && decision !== "rejected")) {
    return { status: "error", message: messageFor("invalid-input") };
  }
  if (note.length > 3000) return { status: "error", message: "Notatet kan være høyst 3000 tegn." };
  const { error } = await op.supabase.rpc("platform_review_onboarding_request", {
    p_request_id: requestId,
    p_decision: decision,
    p_note: note,
  });
  if (error) {
    return refuse(op.supabase, error, {
      action: decision === "approved" ? "onboarding_request.approve" : "onboarding_request.reject",
      targetType: "onboarding_request",
      targetId: requestId,
    });
  }
  revalidatePath("/platform-admin", "layout");
  return {
    status: "ok",
    message: decision === "approved"
      ? "Forespørselen er godkjent. Opprett fellesskapet når dere er klare."
      : "Forespørselen er avslått.",
  };
}

export async function saveRequestNoteAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const op = await operator();
  if (!op) return FORBIDDEN;
  if (!op.supabase) return { status: "error", message: messageFor("platform-mfa-required") };
  const requestId = text(formData, "requestId");
  const note = text(formData, "note");
  if (!UUID.test(requestId)) return { status: "error", message: messageFor("request-not-found") };
  if (note.length > 3000) return { status: "error", message: "Notatet kan være høyst 3000 tegn." };
  const { error } = await op.supabase.rpc("platform_set_onboarding_note", { p_request_id: requestId, p_note: note });
  if (error) return refuse(op.supabase, error, { action: "onboarding_request.note", targetType: "onboarding_request", targetId: requestId });
  revalidatePath("/platform-admin", "layout");
  return { status: "ok", message: "Notatet er lagret." };
}

// ── Platform operators (owners, with a fresh second factor) ──────────────

export async function appointOperatorAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const op = await operator();
  if (!op) return FORBIDDEN;
  if (!op.supabase) return { status: "error", message: messageFor("platform-mfa-required") };
  const email = text(formData, "email").toLowerCase();
  const role = text(formData, "role");
  if (!looksLikeEmail(email)) return { status: "error", message: "Ikke en gyldig e-postadresse.", fields: { email: "Ikke en gyldig e-postadresse." } };
  if (role !== "owner" && role !== "operator") return { status: "error", message: messageFor("invalid-input") };
  const { error } = await op.supabase.rpc("platform_appoint_operator", { p_email: email, p_role: role });
  if (error) return refuse(op.supabase, error, { action: "platform_operator.appoint", targetType: "platform_operator" });
  revalidatePath("/platform-admin", "layout");
  return {
    status: "ok",
    message: `${email} er utnevnt som ${role === "owner" ? "plattformeier" : "plattformoperatør"}. Personen må sette opp tofaktorinnlogging før dashbordet kan brukes.`,
  };
}

export async function setOperatorRoleAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const op = await operator();
  if (!op) return FORBIDDEN;
  if (!op.supabase) return { status: "error", message: messageFor("platform-mfa-required") };
  const userId = text(formData, "userId");
  const role = text(formData, "role");
  if (!UUID.test(userId) || (role !== "owner" && role !== "operator")) return { status: "error", message: messageFor("invalid-input") };
  const { data, error } = await op.supabase.rpc("platform_set_operator_role", { p_user_id: userId, p_role: role });
  if (error) return refuse(op.supabase, error, { action: "platform_operator.role", targetType: "platform_operator", targetId: userId });
  revalidatePath("/platform-admin", "layout");
  return { status: "ok", message: data ? "Rollen er endret." : "Rollen var allerede den samme." };
}

export async function revokeOperatorAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const op = await operator();
  if (!op) return FORBIDDEN;
  if (!op.supabase) return { status: "error", message: messageFor("platform-mfa-required") };
  const userId = text(formData, "userId");
  if (!UUID.test(userId)) return { status: "error", message: messageFor("invalid-input") };
  const { error } = await op.supabase.rpc("platform_revoke_operator", { p_user_id: userId });
  if (error) return refuse(op.supabase, error, { action: "platform_operator.revoke", targetType: "platform_operator", targetId: userId });
  revalidatePath("/platform-admin", "layout");
  return { status: "ok", message: "Tilgangen er fjernet. Den gjelder fra neste forespørsel personen gjør." };
}
