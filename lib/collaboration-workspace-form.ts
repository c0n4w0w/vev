import type { WorkspaceMessage } from "@/lib/types";

/**
 * Shared shapes for the workspace actions.
 *
 * Outside `app/collaboration-workspace-actions.ts` because a `"use server"`
 * module may only export async functions. Messages are resolved on the server
 * in the collaboration's language, so a state carries finished text.
 *
 * The limits mirror the database constraints; the database is the one that
 * enforces them.
 */
export type WorkspaceFormState = {
  status: "idle" | "ok" | "error";
  message?: string;
  /** Set when a form created something the page should move to. */
  id?: string;
};

export const emptyWorkspaceFormState: WorkspaceFormState = { status: "idle" };

export type MessagePostState =
  | { status: "idle" }
  | { status: "ok"; message: WorkspaceMessage }
  | { status: "error"; error: string };

export const emptyMessagePostState: MessagePostState = { status: "idle" };

export type DocumentSaveState =
  | { status: "idle" }
  | { status: "saved"; revision: number; message: string }
  | { status: "unchanged"; revision: number; message: string }
  | { status: "conflict"; revision: number; message: string }
  | { status: "error"; message: string };

export const emptyDocumentSaveState: DocumentSaveState = { status: "idle" };

export const CHANNEL_NAME_MAX = 40;
export const CHANNEL_DESCRIPTION_MAX = 300;
export const MESSAGE_MAX = 4000;
export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 4000;
export const DOCUMENT_TITLE_MAX = 200;
export const DOCUMENT_CONTENT_MAX = 100_000;
export const EVENT_TITLE_MAX = 200;
export const EVENT_DESCRIPTION_MAX = 5000;
export const EVENT_NOTES_MAX = 10_000;
export const EVENT_LOCATION_MAX = 300;
export const EVENT_URL_MAX = 500;
export const FILE_NAME_MAX = 200;

/**
 * The same shaping `normalize_channel_name()` does, so the form can show the
 * name the channel will actually get before it is sent.
 */
export function channelNamePreview(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^a-z0-9æøå]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, CHANNEL_NAME_MAX)
    .replace(/-+$/g, "");
}

/** Only these may be put into a task's or file's name: no controls, no slashes. */
export function cleanDisplayName(input: string): string {
  return input.replace(/[\u0000-\u001f\u007f/\\]+/g, " ").replace(/\s+/g, " ").trim();
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A uuid from a form field, or null. */
export function uuidOrNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "");
  return UUID.test(text) ? text : null;
}

/** An `https?://` URL a person typed, or null if blank; undefined if unusable. */
export function registrationUrl(value: string): string | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > EVENT_URL_MAX) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (/[\s<>"]/.test(trimmed)) return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}
