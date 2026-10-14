/**
 * Shared shapes for administrators managing a community's own channels and
 * sections: creating, moving, ordering, archiving, deleting.
 *
 * Outside `app/channel-actions.ts` because a `"use server"` module may only
 * export async functions. The limits mirror `channels_name_valid`,
 * `channel_sections_name_valid` and the functions in 20261028100000, so a
 * value refused here would be refused there too; this only answers without a
 * round trip.
 */
import { PLATFORM_LOCALE, translator, type Translator } from "@/lib/i18n";
import { CHANNEL_NAME_MAX, normalizeChannelDetails } from "@/lib/channel-edit-form";
import type { Channel } from "@/lib/types";

export const SECTION_NAME_MAX = CHANNEL_NAME_MAX;

/** Every management action: success, or a message the form can show. */
export type ChannelManageFormState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; error: string };

export const emptyChannelManageFormState: ChannelManageFormState = { status: "idle" };

/** A community's own channel, as opposed to a lokallag chat or a group's. */
export function isCommunityChannel(channel: Pick<Channel, "localGroupId" | "subgroupId">): boolean {
  return !channel.localGroupId && !channel.subgroupId;
}

// Same set as Postgres' [[:cntrl:]].
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function normalizeSectionName(
  raw: string,
  t: Translator = translator(PLATFORM_LOCALE),
): { ok: true; name: string } | { ok: false; message: string } {
  const name = raw.trim();
  if (!name || CONTROL.test(name)) return { ok: false, message: t("err.sectionNameEmpty") };
  if (Array.from(name).length > SECTION_NAME_MAX) {
    return { ok: false, message: t("err.sectionNameTooLong", { max: SECTION_NAME_MAX }) };
  }
  return { ok: true, name };
}

export { normalizeChannelDetails };

/** A creation key's shape. Anything else is dropped rather than passed on. */
export const CREATION_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
