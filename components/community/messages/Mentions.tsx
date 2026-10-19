"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { EmojiText } from "@/components/community/EmojiPicker";
import { PersonPopover } from "@/components/community/messages/PersonPopover";
import { Avatar, cn } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/react";
import {
  activeMentionQuery,
  draftToStored,
  splitMentions,
  type MentionCandidate,
  type MentionDraft,
} from "@/lib/mentions";
import type { CommunityEmoji, CommunityPersona } from "@/lib/types";

/**
 * @mentions in a channel's composer and in its inline editor, and the way a
 * sent message shows them.
 *
 * Typing "@" after a space (or at the start) asks the database who may be
 * mentioned in this channel (…/channel/<id>/mentions → search_channel_
 * mention_candidates): a small list near the caret, at most 8 people, never the
 * membership list. Picking one writes "@Name " into the text and remembers who
 * it was; only those picked names become mentions when the text is sent
 * (`draftToStored`). Pasted text never opens the list, and Escape closes it
 * until the next "@".
 *
 * Every send and edit is checked again by the database, which refuses a
 * mention of anyone who may not be mentioned there.
 */

/** Where a channel's mentions are looked up, and how the list is worded. */
export interface MentionScope {
  communityId: string;
  channelId: string;
  /** A private lokallag channel or group chat: invited people can be mentioned. */
  invited: boolean;
}

const DEBOUNCE_MS = 140;
const MENU_WIDTH = 272;

/** Where the list sits in its positioned ancestor. */
type MenuPosition = { left: number; offset: number; frameWidth: number };

// ── Caret position ──────────────────────────────────────────────────────

const MIRRORED = [
  "boxSizing",
  "width",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
] as const;

/** Where a character of a textarea is drawn, relative to the textarea's box. */
function caretPoint(textarea: HTMLTextAreaElement, position: number): { left: number; top: number; height: number } {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  for (const property of MIRRORED) mirror.style[property] = style[property];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.textContent = textarea.value.slice(0, position);
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(position) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  const point = {
    left: marker.offsetLeft - textarea.scrollLeft,
    top: marker.offsetTop - textarea.scrollTop,
    height: lineHeight,
  };
  mirror.remove();
  return point;
}

// ── The composer's side ─────────────────────────────────────────────────

/**
 * Mention suggestions for one controlled textarea. The caller keeps the text;
 * this keeps who was picked, the "@query" at the caret and the list.
 *
 * Wire it up with `onChange` (after setting the value), `onKeyDown` (first —
 * it returns true when it used the key), `onCaretMove` on click and on
 * keyup, `textareaProps` for the combobox semantics, and render `menu` inside
 * a positioned ancestor (`anchorRef`).
 */
export function useMentionAutocomplete({
  scope,
  textareaRef,
  anchorRef,
  value,
  setValue,
  initialMentions,
  placement = "above",
  onPick,
}: {
  scope?: MentionScope;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** The positioned element the list is placed in. */
  anchorRef: RefObject<HTMLElement | null>;
  value: string;
  setValue: (next: string) => void;
  initialMentions?: MentionDraft[];
  /** Above the text (a composer at the bottom) or below it (an inline editor). */
  placement?: "above" | "below";
  /** Told about each person picked, so the message can show them once sent. */
  onPick?: (candidate: MentionCandidate) => void;
}) {
  const t = useT();
  const listId = useId();
  const [mentions, setMentions] = useState<MentionDraft[]>(initialMentions ?? []);
  const [active, setActive] = useState<{ start: number; query: string } | null>(null);
  const [results, setResults] = useState<MentionCandidate[]>([]);
  const [settledQuery, setSettledQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  // The "@" the list was closed for (Escape, a paste, a pick): it stays
  // closed while the caret is still in that same "@…".
  const dismissedAt = useRef<number | null>(null);
  const pasting = useRef(false);
  const cache = useRef(new Map<string, MentionCandidate[]>());
  const requestId = useRef(0);
  const pendingCaret = useRef<number | null>(null);

  const enabled = Boolean(scope);

  const place = useCallback(
    (start: number) => {
      const textarea = textareaRef.current;
      const anchor = anchorRef.current;
      if (!textarea || !anchor) return;
      const caret = caretPoint(textarea, start);
      const box = textarea.getBoundingClientRect();
      const frame = anchor.getBoundingClientRect();
      const left = box.left - frame.left + caret.left;
      setPosition({
        left,
        frameWidth: anchor.clientWidth,
        offset:
          placement === "above"
            ? frame.bottom - (box.top + caret.top) + 6
            : box.top - frame.top + caret.top + caret.height + 6,
      });
    },
    [textareaRef, anchorRef, placement],
  );

  /** Reads the "@query" at the caret again; opens, follows or closes the list. */
  const sync = useCallback(() => {
    const textarea = textareaRef.current;
    if (!enabled || !textarea) return;
    const caret = textarea.selectionStart ?? 0;
    const found = textarea.selectionStart === textarea.selectionEnd
      ? activeMentionQuery(textarea.value, caret)
      : null;
    if (pasting.current) {
      pasting.current = false;
      dismissedAt.current = found?.start ?? null;
      setActive(null);
      return;
    }
    if (!found) {
      dismissedAt.current = null;
      setActive(null);
      return;
    }
    if (found.start === dismissedAt.current) {
      setActive(null);
      return;
    }
    dismissedAt.current = null;
    setActive((current) =>
      current && current.start === found.start && current.query === found.query ? current : found,
    );
    place(found.start);
  }, [enabled, textareaRef, place]);

  // Search, debounced, newest answer only.
  const query = active?.query;
  useEffect(() => {
    if (!scope || query === undefined) return;
    const key = query.toLocaleLowerCase("nb-NO");
    const cached = cache.current.get(key);
    const id = ++requestId.current;
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        let found = cached;
        if (!found) {
          const url = `/community/${encodeURIComponent(scope.communityId)}/channel/${encodeURIComponent(scope.channelId)}/mentions?q=${encodeURIComponent(query)}`;
          try {
            const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
            found = response.ok ? ((await response.json()) as MentionCandidate[]) : [];
          } catch {
            return;
          }
          cache.current.set(key, found);
        }
        if (id !== requestId.current) return;
        setResults(found);
        setHighlight(0);
        setSettledQuery(query);
      },
      cached ? 0 : DEBOUNCE_MS,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [scope, query]);

  // A pick moves the caret to just after the name it wrote.
  useEffect(() => {
    const caret = pendingCaret.current;
    const textarea = textareaRef.current;
    if (caret === null || !textarea) return;
    pendingCaret.current = null;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
  }, [value, textareaRef]);

  const open = enabled && active !== null;
  const ready = open && settledQuery === active.query;
  const shown = ready ? results : [];

  function pick(candidate: MentionCandidate) {
    const textarea = textareaRef.current;
    if (!active || !textarea) return;
    const end = textarea.selectionStart ?? active.start + 1 + active.query.length;
    const inserted = `@${candidate.name} `;
    const next = value.slice(0, active.start) + inserted + value.slice(end);
    pendingCaret.current = active.start + inserted.length;
    dismissedAt.current = active.start;
    setMentions((current) => [...current, { userId: candidate.id, name: candidate.name }]);
    onPick?.(candidate);
    setActive(null);
    setValue(next);
  }

  function close() {
    if (active) dismissedAt.current = active.start;
    setActive(null);
  }

  return {
    mentions,
    /** The text as it is stored: picked names as mentions, everything else as typed. */
    stored: (text: string) => draftToStored(text, mentions),
    /** Forget everything picked — after a send, or when the draft is thrown away. */
    reset: (next: MentionDraft[] = []) => {
      setMentions(next);
      setActive(null);
      dismissedAt.current = null;
    },
    /** Put back what a failed send took out. */
    restore: (previous: MentionDraft[]) => setMentions(previous),
    onChange(event: ChangeEvent<HTMLTextAreaElement>) {
      const type = (event.nativeEvent as InputEvent).inputType ?? "";
      if (type === "insertFromPaste" || type === "insertFromDrop" || type === "insertFromYank") {
        pasting.current = true;
      }
      sync();
    },
    onPaste() {
      pasting.current = true;
    },
    onCaretMove: sync,
    /** The caret moved by keyboard without changing the text. */
    onKeyUp(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (/^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key)) sync();
    },
    /** Arrow keys, Enter, Tab and Escape while the list is open. True when the key was used. */
    onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
      if (!open || event.nativeEvent.isComposing) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return true;
      }
      if (shown.length === 0) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlight((current) => (current + step + shown.length) % shown.length);
        return true;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        pick(shown[Math.min(highlight, shown.length - 1)]);
        return true;
      }
      return false;
    },
    textareaProps: enabled
      ? {
          role: "combobox" as const,
          "aria-autocomplete": "list" as const,
          "aria-expanded": open,
          "aria-controls": open ? listId : undefined,
          "aria-activedescendant": open && shown.length > 0 ? `${listId}-${highlight}` : undefined,
        }
      : {},
    menu: open ? (
      <MentionMenu
        id={listId}
        results={shown}
        ready={ready}
        highlight={highlight}
        invited={Boolean(scope?.invited)}
        placement={placement}
        position={position}
        onHighlight={setHighlight}
        onPick={pick}
        label={t("mention.listLabel")}
      />
    ) : null,
  };
}

function MentionMenu({
  id,
  results,
  ready,
  highlight,
  invited,
  placement,
  position,
  onHighlight,
  onPick,
  label,
}: {
  id: string;
  results: MentionCandidate[];
  ready: boolean;
  highlight: number;
  invited: boolean;
  placement: "above" | "below";
  position: MenuPosition | null;
  onHighlight: (index: number) => void;
  onPick: (candidate: MentionCandidate) => void;
  label: string;
}) {
  const t = useT();
  const listRef = useRef<HTMLUListElement>(null);
  // Near the "@", but never past either edge of the composer — a phone's
  // 375px included.
  const frameWidth = position?.frameWidth ?? MENU_WIDTH;
  const width = Math.min(MENU_WIDTH, frameWidth);
  const left = Math.max(0, Math.min((position?.left ?? 0) - 12, frameWidth - width));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  return (
    <div
      className="absolute z-30 overflow-hidden rounded-[6px] border border-line-2 bg-surface shadow-[0_8px_24px_rgba(23,25,26,0.12)]"
      style={{
        left,
        width,
        ...(placement === "above" ? { bottom: position?.offset ?? "100%" } : { top: position?.offset ?? "100%" }),
      }}
    >
      <ul ref={listRef} id={id} role="listbox" aria-label={label} className="max-h-60 overflow-y-auto py-1">
        {results.map((candidate, index) => (
          <li
            key={candidate.id}
            id={`${id}-${index}`}
            data-index={index}
            role="option"
            aria-label={candidate.name}
            aria-selected={index === highlight}
            // Keep the focus (and the caret) in the text while picking, for
            // mouse and touch alike.
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(candidate)}
            onMouseEnter={() => onHighlight(index)}
            className={cn(
              "flex min-h-10 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px] text-ink",
              index === highlight ? "bg-paper-2" : "bg-transparent",
            )}
          >
            <Avatar user={{ ...candidate, communityId: undefined }} size="xs" />
            <span className="min-w-0 truncate">{candidate.name}</span>
          </li>
        ))}
      </ul>
      {results.length === 0 ? (
        <p className="px-3 py-2.5 text-[12px] leading-snug text-ink-3">
          {ready ? (
            <>
              <span className="block text-ink-2">{t("mention.none")}</span>
              <span className="mt-0.5 block">{t(invited ? "mention.hintInvited" : "mention.hint")}</span>
            </>
          ) : (
            t("mention.searching")
          )}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {ready ? (results.length > 0 ? t("mention.results", { count: results.length }) : t("mention.none")) : ""}
      </p>
    </div>
  );
}

// ── The message's side ──────────────────────────────────────────────────

/**
 * A sent message's text: custom emojis as pictures, mentions as the person's
 * current name in this community. A mention opens their profile card in place
 * (PersonPopover). A mention of someone this viewer cannot see (anymore)
 * reads "@ukjent" and opens nothing.
 */
export function MessageText({
  body,
  emojis,
  people,
  communityId,
  channelId,
  viewerId,
}: {
  body: string;
  emojis?: CommunityEmoji[];
  people: Record<string, CommunityPersona | undefined>;
  communityId: string;
  channelId: string;
  viewerId?: string;
}) {
  const t = useT();
  const segments = useMemo(() => splitMentions(body), [body]);
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "text") return <EmojiText key={index} body={segment.text} emojis={emojis} />;
        const person = people[segment.userId];
        if (!person) {
          return (
            <span key={index} className="text-ink-3">
              @{t("common.unknown").toLocaleLowerCase()}
            </span>
          );
        }
        const self = segment.userId === viewerId;
        return (
          <PersonPopover
            key={index}
            communityId={communityId}
            channelId={channelId}
            userId={segment.userId}
            person={person}
            ariaLabel={self ? `${t("mention.you")}: ${person.name}` : undefined}
            className={cn(
              "inline rounded-[3px] px-0.5 font-medium transition-colors [box-decoration-break:clone]",
              self
                ? "bg-skog-soft text-skog hover:bg-skog/15"
                : "bg-fjord-soft text-fjord hover:bg-fjord/15",
            )}
          >
            @{person.name}
          </PersonPopover>
        );
      })}
    </>
  );
}
