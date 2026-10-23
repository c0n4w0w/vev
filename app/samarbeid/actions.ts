"use server";

import { headers } from "next/headers";
import { clientIpFrom, trustedProxyCount } from "@/lib/client-ip";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { PlatformFormState } from "@/lib/platform/forms";
import { looksLikeEmail } from "@/lib/platform/forms";

/**
 * The public "work with TING" form. Records a request for TING to review;
 * creates nothing else — no account, no community, no email to anyone.
 *
 * Abuse protection, from cheap to firm: a field people never see (bots fill
 * it), a minimum time on the page, and in the database a limit per network
 * address (a hash of it, kept for a day), per address of the requester and
 * overall per hour. The database is the one that holds: submit_onboarding_request
 * is callable only with the service role, so nobody can post past this
 * action's address handling.
 *
 * Every well-formed submission gets the same answer, stored or not.
 */
const THANKS = "Takk! Vi har mottatt forespørselen og tar kontakt på e-post.";

export async function submitOnboardingRequestAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  const value = (name: string) => {
    const raw = formData.get(name);
    return typeof raw === "string" ? raw.trim() : "";
  };

  // Honeypot and timing: answer as if accepted, store nothing.
  if (value("company_url")) return { status: "ok", message: THANKS };
  const startedAt = Number(value("startedAt"));
  if (!Number.isFinite(startedAt) || Date.now() - startedAt < 3000) return { status: "ok", message: THANKS };

  const organizationName = value("organizationName");
  const contactName = value("contactName");
  const contactEmail = value("contactEmail").toLowerCase();
  const website = value("website");
  const estimateText = value("memberEstimate");
  const message = value("message");

  const fields: Record<string, string> = {};
  if (organizationName.length < 2 || organizationName.length > 120) fields.organizationName = "Mellom 2 og 120 tegn.";
  if (contactName.length < 1 || contactName.length > 120) fields.contactName = "Skriv navnet ditt.";
  if (!looksLikeEmail(contactEmail)) fields.contactEmail = "Skriv en gyldig e-postadresse.";
  if (website && (website.length > 300 || !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(website))) {
    fields.website = "En adresse som begynner med https://";
  }
  const memberEstimate = estimateText ? Number(estimateText) : null;
  if (memberEstimate !== null && (!Number.isInteger(memberEstimate) || memberEstimate < 1 || memberEstimate > 10_000_000)) {
    fields.memberEstimate = "Et helt tall.";
  }
  if (message.length < 10 || message.length > 3000) fields.message = "Mellom 10 og 3000 tegn.";
  if (value("consent") !== "on") fields.consent = "Kryss av for at vi kan lagre opplysningene.";
  if (Object.keys(fields).length > 0) return { status: "error", message: "Se over feltene som er markert.", fields };

  const clientKey = clientIpFrom((await headers()).get("x-forwarded-for"), trustedProxyCount());
  const { data, error } = await createSupabaseAdminClient().rpc("submit_onboarding_request", {
    p_organization_name: organizationName,
    p_contact_name: contactName,
    p_contact_email: contactEmail,
    p_website: website,
    // Optional: JSON null reaches the function as SQL null.
    p_member_estimate: memberEstimate as number,
    p_message: message,
    p_client_key: clientKey ?? "",
  });
  if (error || data !== true) {
    if (error) console.error(`[samarbeid] submit_onboarding_request: ${error.code} ${error.message}`);
    return { status: "error", message: "Forespørselen kunne ikke sendes. Prøv igjen senere, eller skriv til hei@join-ting.no." };
  }
  return { status: "ok", message: THANKS };
}
