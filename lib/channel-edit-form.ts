/**
 * Shared shape for editing a channel's display name and description.
 *
 * The limits mirror the `channels_name_valid` / `channels_purpose_length`
 * constraints and `set_channel_details()`, so a value refused here would be
 * refused there too; this just answers without a round trip.
 */
import { PLATFORM_LOCALE, translator, type Translator } from "@/lib/i18n";

export type ChannelEditFormState =
  | { status: "idle" }
  | { status: "ok"; name: string; purpose: string }
  | { status: "error"; message: string };

export const emptyChannelEditFormState: ChannelEditFormState = { status: "idle" };

export const CHANNEL_NAME_MAX = 40;
export const CHANNEL_PURPOSE_MAX = 200;

// Same set as Postgres' [[:cntrl:]]: newlines, tabs and other control characters.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function normalizeChannelDetails(
  rawName: string,
  rawPurpose: string,
  t: Translator = translator(PLATFORM_LOCALE),
): { ok: true; name: string; purpose: string } | { ok: false; message: string } {
  const name = rawName.trim();
  const purpose = rawPurpose.trim();
  if (!name || CONTROL.test(name)) return { ok: false, message: t("err.channelNameEmpty") };
  if (Array.from(name).length > CHANNEL_NAME_MAX) {
    return { ok: false, message: t("err.channelNameTooLong", { max: CHANNEL_NAME_MAX }) };
  }
  if (CONTROL.test(purpose) || Array.from(purpose).length > CHANNEL_PURPOSE_MAX) {
    return { ok: false, message: t("err.channelPurposeTooLong", { max: CHANNEL_PURPOSE_MAX }) };
  }
  return { ok: true, name, purpose };
}
