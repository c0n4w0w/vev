/**
 * The shape of a channel poll, shared by the composer and the server action.
 *
 * The database (create_channel_poll, 20261111100000) holds the same limits
 * and checks them again; these let the form say what is wrong before a
 * round trip, and let the action refuse junk without asking.
 */
import type { MessageKey } from "@/lib/i18n";

export const POLL_QUESTION_MAX = 300;
export const POLL_OPTION_MAX = 120;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 10;

// Control characters (newlines included) are refused by the database.
const CONTROL = /[\u0000-\u001f\u007f]/;

/** One line of text, as the database will store it. */
export function pollLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export type PollVisibilityChoice = "anonymous" | "visible";

export type PollDraft = { question: string; options: string[]; visibility: PollVisibilityChoice };

/**
 * The poll as it would be sent, or what is wrong with it. Empty option fields
 * are left out, so a form with spare rows still sends.
 */
export function shapePoll(input: { question: unknown; options: unknown; visibility?: unknown }):
  | { ok: true; poll: PollDraft }
  | { ok: false; error: MessageKey } {
  if (typeof input.question !== "string" || !Array.isArray(input.options)) {
    return { ok: false, error: "poll.err.invalid" };
  }
  if (input.options.length > 50 || input.options.some((option) => typeof option !== "string")) {
    return { ok: false, error: "poll.err.invalid" };
  }
  const question = pollLine(input.question);
  if (!question) return { ok: false, error: "poll.err.questionEmpty" };
  if (question.length > POLL_QUESTION_MAX || CONTROL.test(question)) return { ok: false, error: "poll.err.questionTooLong" };

  const options = (input.options as string[]).map(pollLine).filter(Boolean);
  if (options.length < POLL_OPTIONS_MIN) return { ok: false, error: "poll.err.tooFewOptions" };
  if (options.length > POLL_OPTIONS_MAX) return { ok: false, error: "poll.err.tooManyOptions" };
  if (options.some((option) => option.length > POLL_OPTION_MAX || CONTROL.test(option))) {
    return { ok: false, error: "poll.err.optionTooLong" };
  }
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
    return { ok: false, error: "poll.err.duplicate" };
  }
  // Anonymous unless visible votes were asked for in so many words.
  if (input.visibility !== undefined && input.visibility !== "anonymous" && input.visibility !== "visible") {
    return { ok: false, error: "poll.err.invalid" };
  }
  const visibility: PollVisibilityChoice = input.visibility === "visible" ? "visible" : "anonymous";
  return { ok: true, poll: { question, options, visibility } };
}

/** Whole-number percentage of `count` in `total`, 0 when nobody voted. */
export function pollPercent(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}
