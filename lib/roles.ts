import type { Role, RoleId } from "@/lib/types";

/**
 * Role definitions. Kept out of the data layer because the labels are used by
 * Client Components too — importing them must not pull in a database client.
 */
export const roles: Record<RoleId, Role> = {
  member: {
    id: "member",
    label: "Medlem",
    description: "Kan lese og delta i åpne kanaler, og melde seg på arrangementer.",
  },
  moderator: {
    id: "moderator",
    label: "Moderator",
    description: "Følger opp samtaler, kan feste innlegg og håndtere kanaler.",
  },
  admin: {
    id: "admin",
    label: "Administrator",
    description: "Styrer medlemskap, invitasjoner, roller og fellesskapets profil.",
  },
};

export function getRole(roleId: RoleId): Role {
  return roles[roleId];
}

export function publicMemberTitle(title?: string | null) {
  const trimmed = title?.trim();
  if (!trimmed || trimmed.toLocaleLowerCase("nb-NO") === "medlem") return undefined;
  return trimmed;
}
