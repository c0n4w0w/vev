import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { demoPersonas } from "@/lib/mock/demo-personas";
import { users } from "@/lib/mock/users";

/**
 * Makes one existing account the administrator of one community.
 *
 * A community with nobody in it has no one who can approve its first member,
 * so the first administrator cannot come through the ordinary request-and-
 * approval path. This is the one other way in. It is deliberately small:
 *
 * - **It names nobody.** The address is given on the command line by whoever
 *   runs it, on the server, with the service-role key. No administrator is
 *   written down in the repository, a migration or an environment variable.
 * - **It creates nothing but the membership.** The person has already made
 *   their own account at /login, confirmed the address and chosen a password
 *   — the same three things the database demands before any membership
 *   becomes active (20261025100000). This never creates an account, sets or
 *   resets a password, confirms an address, sends an email or mints a link.
 *   An account that is not ready is refused, and the answer says what the
 *   person has to do themselves.
 * - **One per community.** memberships_one_active_admin_per_community_idx
 *   allows one active administrator. If the community has one, this refuses;
 *   handing the role on is done by that administrator, in the app.
 * - **No showcase accounts.** The fixture cast's addresses are refused
 *   outside a showcase deployment, whatever state their accounts are in.
 *
 * Running it again for the same person and community changes nothing.
 */

type Admin = SupabaseClient<Database>;

export type AdministratorPlan =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** `none` when the person already is the community's administrator. */
      action: "create" | "promote" | "none";
      userId: string;
      communityId: string;
    };

const fixtureAddresses = new Set([...users, ...demoPersonas].map((user) => user.email.toLowerCase()));

export async function planFirstAdministrator(
  admin: Admin,
  input: { community: string; email: string; allowFixtures?: boolean },
): Promise<AdministratorPlan> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: "Adressen er ikke en e-postadresse." };
  if (fixtureAddresses.has(email) && !input.allowFixtures) {
    return { ok: false, reason: "Adressen tilhører showcasens testkontoer og kan ikke administrere et ekte fellesskap." };
  }

  const { data: community, error: communityError } = await admin
    .from("communities")
    .select("id")
    .eq("slug", input.community)
    .maybeSingle();
  if (communityError) return { ok: false, reason: `Kunne ikke lese fellesskapet: ${communityError.message}` };
  if (!community) return { ok: false, reason: `Fellesskapet «${input.community}» finnes ikke. Kjør \`npm run bootstrap\` først.` };

  // Every account has a profile row (handle_new_user), keyed on its address.
  const { data: profile, error: profileError } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (profileError) return { ok: false, reason: `Kunne ikke lese kontoen: ${profileError.message}` };
  const { data: account } = profile ? await admin.auth.admin.getUserById(profile.id) : { data: null };
  const user = account?.user;
  if (!user || user.email?.toLowerCase() !== email) {
    return {
      ok: false,
      reason: "Ingen TING-konto har denne adressen. Personen oppretter kontoen selv på /login; dette oppretter aldri kontoer.",
    };
  }
  if (!user.email_confirmed_at) {
    return { ok: false, reason: "Kontoen har ikke bekreftet adressen sin. Personen logger inn med lenken de fikk på e-post først." };
  }
  if ((user as { banned_until?: string | null }).banned_until) {
    return { ok: false, reason: "Kontoen er sperret." };
  }

  const { data: security, error: securityError } = await admin
    .from("account_security")
    .select("password_set_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (securityError) return { ok: false, reason: `Kunne ikke lese kontoens sikkerhetsstatus: ${securityError.message}` };
  if (!security?.password_set_at) {
    return {
      ok: false,
      reason: "Kontoen har ikke noe passord. Personen velger ett selv under Kontoen din → Sikkerhet (/profile/passord) først.",
    };
  }

  const { data: members, error: membersError } = await admin
    .from("memberships")
    .select("user_id, role, status")
    .eq("community_id", community.id);
  if (membersError) return { ok: false, reason: `Kunne ikke lese medlemskapene: ${membersError.message}` };

  const current = members.find((row) => row.role === "admin" && row.status === "active");
  if (current && current.user_id !== user.id) {
    return {
      ok: false,
      reason: "Fellesskapet har allerede en aktiv administrator. Rollen gis videre av administratoren, i appen.",
    };
  }
  const own = members.find((row) => row.user_id === user.id);
  return { ok: true, action: current ? "none" : own ? "promote" : "create", userId: user.id, communityId: community.id };
}

export async function grantFirstAdministrator(
  admin: Admin,
  plan: Extract<AdministratorPlan, { ok: true }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (plan.action === "create") {
    const { error } = await admin
      .from("memberships")
      .insert({ user_id: plan.userId, community_id: plan.communityId, role: "admin", status: "active" });
    // 23505: someone became administrator between the plan and now.
    if (error) return { ok: false, reason: error.code === "23505" ? "Fellesskapet fikk en administrator i mellomtiden." : error.message };
  } else if (plan.action === "promote") {
    const { error } = await admin
      .from("memberships")
      .update({ role: "admin", status: "active" })
      .eq("user_id", plan.userId)
      .eq("community_id", plan.communityId);
    if (error) return { ok: false, reason: error.code === "23505" ? "Fellesskapet fikk en administrator i mellomtiden." : error.message };
  }
  return { ok: true };
}
