import "server-only";

import { sendInvitationEmail } from "@/lib/email/invitation";
import { mintEmailSignInLink } from "@/lib/email-sign-in-link";
import { siteOrigin } from "@/lib/site-url";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * The one email a community's appointed administrator gets.
 *
 * The same message, delivery and link shape as an approval
 * (app/actions.ts → deliverApprovalEmail), with administrator wording. It runs
 * only after a platform database function has authorised the appointment for
 * the signed-in operator and returned the address and token, and only for
 * that address. The service-role client is used for `generateLink` alone — the
 * same narrow exception lib/supabase/admin.ts lists for approvals.
 *
 * The community's name, language and colour are passed in rather than read
 * here: the operator is not a member, so a membership-scoped read would find
 * nothing, and they come from the platform function that just answered.
 */
export async function sendAdminAppointmentEmail(input: {
  kind: "new" | "existing";
  token: string | null;
  email: string;
  expiresAt: string | null;
  community: { id: string; name: string; slug: string; locale: "nb" | "en"; accent: string };
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (input.kind === "new" && (!input.token || !input.expiresAt)) {
    return { ok: false, message: "Invitasjonen mangler. Send den på nytt fra fellesskapets side." };
  }

  const origin = await siteOrigin();
  const signIn = await mintEmailSignInLink(createSupabaseAdminClient(), {
    email: input.email,
    communityId: input.community.id,
  }).catch(() => null);

  const params = new URLSearchParams();
  if (signIn) params.set("innlogging", signIn.tokenHash);
  let acceptUrl: string;
  if (input.kind === "new") {
    acceptUrl = `${origin}/invitasjon/${input.token}${params.size ? `?${params}` : ""}`;
  } else if (signIn) {
    params.set("f", input.community.slug);
    acceptUrl = `${origin}/velkommen?${params}`;
  } else {
    acceptUrl = `${origin}/login?neste=${encodeURIComponent(`/community/${input.community.id}`)}`;
  }

  const result = await sendInvitationEmail({
    to: input.email,
    kind: input.kind,
    role: "admin",
    origin,
    communityName: input.community.name,
    locale: input.community.locale,
    acceptUrl,
    signInExpiresAt: signIn
      ? input.expiresAt && input.expiresAt < signIn.signInExpiresAt
        ? input.expiresAt
        : signIn.signInExpiresAt
      : undefined,
    invitationExpiresAt: input.expiresAt ?? undefined,
    accent: input.community.accent,
  });

  if (result.ok) return { ok: true };
  const reason =
    result.reason === "local"
      ? result.error
      : {
          temporary: "E-posttjeneren svarte ikke nå. Prøv igjen om litt.",
          rejected: "E-posttjeneren avviste meldingen eller adressen. Kontroller adressen.",
          configuration: "E-post er ikke satt opp riktig på serveren.",
          uncertain: "Forbindelsen brøt underveis. Meldingen kan ha kommet fram – spør mottakeren før du sender på nytt.",
        }[result.reason] ?? "E-posten kunne ikke sendes.";
  return { ok: false, message: reason };
}
