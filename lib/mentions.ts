/**
 * @mentions in chat messages, as text.
 *
 * A mention is stored in the message text as `<@account-id>` and nothing
 * else (20261103100000). The name is looked up when the message is shown, so
 * a person who changes their display name keeps every mention of them. The
 * database reads the same tokens back out of the stored text and decides —
 * for every insert and every edit — whether each person may be mentioned in
 * that channel; nothing here is trusted for that.
 *
 * In the composer the text says `@Name`. Only names the author picked from
 * the suggestions are kept as mentions (`MentionDraft`); turning the draft
 * into stored text replaces exactly those, and any other "@word" stays text.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Matches one stored mention; group 1 is the account id. */
export const MENTION_TOKEN = new RegExp(`<@(${UUID})>`, "g");

/** The most different people one message may mention (the database's limit too). */
export const MENTION_MAX = 20;

/** A picked suggestion in a draft: who, and the name the draft shows for them. */
export interface MentionDraft {
  userId: string;
  name: string;
}

/** One person the composer may suggest, as the database returned them. */
export interface MentionCandidate {
  id: string;
  name: string;
  initials: string;
  avatarUrl?: string;
}

/** The distinct account ids a stored text mentions, in order of first appearance. */
export function mentionIds(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(MENTION_TOKEN)) ids.add(match[1]);
  return [...ids];
}

export type MentionSegment = { kind: "text"; text: string } | { kind: "mention"; userId: string };

/** A stored text cut into plain runs and mentions. */
export function splitMentions(body: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION_TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) segments.push({ kind: "text", text: body.slice(last, at) });
    segments.push({ kind: "mention", userId: match[1] });
    last = at + match[0].length;
  }
  if (last < body.length) segments.push({ kind: "text", text: body.slice(last) });
  return segments;
}

/** A stored text with each mention as `@Name` — for previews and plain-text places. */
export function mentionsAsText(body: string, nameOf: (userId: string) => string | undefined): string {
  return body.replace(MENTION_TOKEN, (_, userId: string) => `@${nameOf(userId) ?? "ukjent"}`);
}

/**
 * A stored text as the composer shows it, with the mentions it holds — for
 * editing a sent message. A mention whose name is unknown keeps its token, so
 * saving the edit unchanged leaves it exactly as it was.
 */
export function mentionsToDraft(
  body: string,
  nameOf: (userId: string) => string | undefined,
): { text: string; mentions: MentionDraft[] } {
  const mentions: MentionDraft[] = [];
  const text = body.replace(MENTION_TOKEN, (token, userId: string) => {
    const name = nameOf(userId);
    if (!name) return token;
    mentions.push({ userId, name });
    return `@${name}`;
  });
  return { text, mentions };
}

const WORD = /[\p{L}\p{N}_]/u;

/**
 * The draft as it is stored: each `@Name` that belongs to a picked mention
 * becomes its token. A name is only taken whole — "@Mia Minge" is not found
 * inside "@Mia Mingesen" — and only after the start, a space or punctuation.
 * Longer names are tried first, so "@Mia Minge" wins over "@Mia". Several
 * picked people with the same name are matched in the order they were picked.
 * Text the author typed without picking stays as it is.
 */
export function draftToStored(text: string, mentions: MentionDraft[]): string {
  if (mentions.length === 0) return text;
  const queues = new Map<string, string[]>();
  for (const mention of mentions) {
    queues.set(mention.name, [...(queues.get(mention.name) ?? []), mention.userId]);
  }
  const names = [...queues.keys()].sort((a, b) => b.length - a.length);
  const lastFor = new Map([...queues].map(([name, ids]) => [name, ids[ids.length - 1]]));

  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "@" && (i === 0 || !WORD.test(text[i - 1]))) {
      const rest = text.slice(i + 1);
      const name = names.find(
        (candidate) => rest.startsWith(candidate) && !WORD.test(rest.charAt(candidate.length)),
      );
      if (name) {
        const queue = queues.get(name)!;
        out += `<@${queue.length > 0 ? queue.shift() : lastFor.get(name)}>`;
        i += 1 + name.length;
        continue;
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/**
 * The "@query" being typed at the caret, if any: an "@" at the start or after
 * a space or bracket, followed by at most 40 characters on the same line that
 * do not start with a space and contain no other "@".
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/[\s([{"'«]/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query) || /^\s/.test(query) || /\s{2}/.test(query)) return null;
  return { start: at, query };
}
