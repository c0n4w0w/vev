import type { CollaborationUnit, RepresentedCollaborationUnit } from "@/lib/types";

/**
 * Shared shapes for the collaboration forms.
 *
 * Outside `app/collaboration-actions.ts` because a `"use server"` module may
 * only export async functions. Messages are resolved on the server in the
 * language of the screen the form sits on, so the state carries finished text.
 */
export type CollaborationFormState = { status: "idle" | "ok" | "error"; message?: string };

export const emptyCollaborationFormState: CollaborationFormState = { status: "idle" };

/** Characters, the same limits the database enforces. */
export const COLLABORATION_NAME_MAX = 120;
export const COLLABORATION_DESCRIPTION_MAX = 2000;

/**
 * How a unit travels through a form: "<communityId>" for the whole
 * community, "<communityId>:<localGroupId>" for one of its local groups. The
 * database re-checks that the caller represents it and that the group belongs
 * to that community; this only carries the choice.
 */
export function encodeUnit(communityId: string, localGroupId?: string | null): string {
  return localGroupId ? `${communityId}:${localGroupId}` : communityId;
}

export function decodeUnit(value: string): { communityId: string; localGroupId: string | null } | null {
  const [communityId, localGroupId, extra] = value.split(":");
  if (!communityId || extra !== undefined) return null;
  if (localGroupId !== undefined && !/^[0-9a-f-]{36}$/.test(localGroupId)) return null;
  return { communityId, localGroupId: localGroupId ?? null };
}

/** A readable slug from a collaboration name, or undefined if none can be made. */
export function slugFromName(name: string): string | undefined {
  const slug = name
    .toLowerCase()
    .replace(/[æ]/g, "ae")
    .replace(/[ø]/g, "o")
    .replace(/[å]/g, "a")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : undefined;
}

/**
 * The units a viewer may act for. Label-only rows (a pending invitee's view of
 * who is already taking part) never pass: they are not represented and carry
 * no ids.
 */
export function isRepresented(unit: CollaborationUnit): unit is RepresentedCollaborationUnit {
  return unit.represented && unit.participantId !== null && unit.communityId !== null;
}
