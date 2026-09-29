/**
 * Inline custom emojis in plain-text messages.
 *
 * A message stays plain text. A custom emoji is written into it as its
 * `:name:` token — the same notation the reaction picker already shows — and
 * only becomes an image at render time, when the token is looked up in the
 * catalogue of the community the message is being read in.
 *
 * Why the name and not the id: names are unique within a community, follow
 * the `community_emojis.name` check, and never change (the table has no UPDATE
 * policy), so an old message keeps meaning what it meant. It also keeps
 * internal ids out of anything a person can read or copy.
 *
 * The token carries no authority. A name that is not in the current
 * community's catalogue — deleted, never existed, or belonging to some other
 * community — is not resolved and stays as the literal text the author typed.
 */

/** Mirrors the `community_emojis.name` check. */
const TOKEN = /:([a-z0-9][a-z0-9_-]{1,31}):/g;

export type EmojiTextSegment =
  | { kind: "text"; text: string }
  | { kind: "emoji"; name: string };

export function emojiToken(name: string): string {
  return `:${name}:`;
}

/**
 * Splits a message body into literal text and known custom emojis.
 *
 * `known` is the set of names that may be resolved. Anything else, including
 * well-formed tokens, is left inside a text segment untouched.
 */
export function splitEmojiText(body: string, known: ReadonlySet<string>): EmojiTextSegment[] {
  const segments: EmojiTextSegment[] = [];
  let cursor = 0;
  let literal = "";

  for (const match of body.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (!known.has(match[1])) continue;

    literal += body.slice(cursor, index);
    if (literal) segments.push({ kind: "text", text: literal });
    literal = "";
    segments.push({ kind: "emoji", name: match[1] });
    cursor = index + match[0].length;
  }

  literal += body.slice(cursor);
  if (literal) segments.push({ kind: "text", text: literal });
  return segments;
}

/**
 * Inserts `insert` into `value` over the selection, returning the new text and
 * where the caret belongs afterwards.
 */
export function insertAtSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  insert: string,
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  return { value: value.slice(0, start) + insert + value.slice(end), caret: start + insert.length };
}

/** Case-insensitive name match, as the reaction picker has always done it. */
export function emojiMatchesQuery(name: string, query: string): boolean {
  return name.includes(query.trim().toLowerCase().replace(/^:|:$/g, ""));
}
