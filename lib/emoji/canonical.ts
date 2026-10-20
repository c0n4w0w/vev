/**
 * One spelling per emoji.
 *
 * The same picture can arrive as several code point sequences: 👍 typed on a
 * phone, 👍️ (with VARIATION SELECTOR-16) from the Unicode dataset. As a
 * reaction those would be two different chips, so every emoji is stored and
 * compared in one form: VS16 only where the character needs it to show as an
 * emoji at all (❤️, ☺️, #️⃣, 🏳️‍🌈) and nowhere else.
 *
 * Shared by the picker, the server actions and the checks. The database
 * accepts any well-shaped string; this is what keeps TING's own writes from
 * splitting one emoji in two.
 */

const VS16 = "️";
const KEYCAP = "⃣";
const ZWJ = "‍";

const textDefault = /^(?=\p{Emoji})(?!\p{Emoji_Presentation})/u;
const modifier = /^\p{Emoji_Modifier}$/u;

export function canonicalEmoji(input: string): string {
  const chars = [...input.normalize("NFC").replaceAll(VS16, "")];
  let out = "";
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    out += char;
    const next = chars[index + 1];
    // A text-default character shown as an emoji: followed by an emoji
    // modifier it needs nothing; otherwise VS16 — as the first element of a
    // ZWJ sequence, before a keycap mark, or alone.
    if (textDefault.test(char) && char !== ZWJ && !(next && modifier.test(next))) {
      // Bare digits, # and * are only emojis as keycaps.
      if (/^[0-9#*]$/.test(char) && next !== KEYCAP) continue;
      out += VS16;
    }
  }
  return out;
}
