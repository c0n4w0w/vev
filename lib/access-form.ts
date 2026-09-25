import { PLATFORM_LOCALE, translator, type Translator } from "@/lib/i18n";

/**
 * Shared shapes for the access-request and invitation forms.
 *
 * Outside `app/actions.ts` because a `"use server"` module may only export
 * async functions.
 */
export type AccessFormState = { status: "idle" | "ok" | "error"; message?: string };

export const emptyAccessFormState: AccessFormState = { status: "idle" };

/**
 * The single answer the public request form ever gives — the message key
 * `ok.requestSent`, said in the community's language.
 *
 * Deliberately identical whether the address was new, already pending, already
 * a member, or rate-limited — anything more specific would let someone test
 * addresses against a community's membership.
 */
export const REQUEST_SENT_KEY = "ok.requestSent" as const;

/**
 * The name or pseudonym on an access request.
 *
 * It is the identity a person will have when they take part in the community,
 * not a legal name: either their own or a pseudonym is fine. It is required
 * for every community, checked in the form, again in the server action, and
 * finally in `request_community_access()` — the only one of the three a
 * direct caller cannot skip. The three agree on what counts as empty, which is
 * broader than a plain trim: tabs, newlines, no-break spaces and zero-width
 * characters draw nothing, so they do not make a name.
 */
export const DISPLAY_NAME_MAX = 80;

const INVISIBLE_EDGE = /^[\s ​-‍⁠﻿]+|[\s ​-‍⁠﻿]+$/g;

export type DisplayNameResult =
  | { ok: true; value: string }
  | { ok: false; message: string };

export function normalizeDisplayName(
  raw: string,
  t: Translator = translator(PLATFORM_LOCALE),
): DisplayNameResult {
  const value = raw.replace(INVISIBLE_EDGE, "");
  if (!value) {
    return { ok: false, message: t("err.nameEmpty") };
  }
  if (value.length > DISPLAY_NAME_MAX) {
    return { ok: false, message: t("err.nameTooLong", { max: DISPLAY_NAME_MAX }) };
  }
  return { ok: true, value };
}
