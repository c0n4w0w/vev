"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { startDirectConversationAction } from "@/app/actions";
import { Avatar, cn } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/react";
import type { CommunityPersona } from "@/lib/types";

/**
 * A name in a channel — a mention or a message's author — that opens a small
 * profile card in place, so nobody has to leave the conversation to see who
 * someone is.
 *
 *   hover (mouse)        opens after a short pause, closes shortly after the
 *                        pointer leaves both the name and the card
 *   click or tap         opens and keeps it open; again closes it
 *   Enter / Space        the same, from the keyboard; Tab then moves into
 *                        the card, which follows the name in the page
 *   Escape               closes it and puts focus back on the name
 *   outside / focus out  closes it
 *
 * Nothing navigates and nothing scrolls. The card is placed beside the name,
 * below it when there is room and above it otherwise, and kept inside the
 * window — at 375px too.
 *
 * Every opening asks …/channel/<id>/people/<userId> again, with the viewer's
 * own session: the database answers only for someone who belongs to this
 * channel's conversation and whom the viewer may see now, and gives the bio
 * only where the whole profile is visible. A person who has left, or a
 * channel the viewer has lost, shows "not available". «Send melding» appears
 * only when the server offers it — Under The Rug, where the viewer may write
 * to them — and opens or starts the conversation through the existing flow,
 * which checks again.
 */

type Card = {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
  bio: string | null;
  communityName: string;
  dm: { conversationId: string | null } | null;
};

type Loaded = { status: "loading" } | { status: "ok"; card: Card } | { status: "gone" };

const CARD_WIDTH = 304;
const GAP = 6;
const MARGIN = 8;
const HOVER_OPEN_MS = 280;
const HOVER_CLOSE_MS = 180;

/** One card at a time: opening one closes whichever was open. */
let closeOpenCard: (() => void) | undefined;

export function PersonPopover({
  communityId,
  channelId,
  userId,
  person,
  className,
  ariaLabel,
  children,
}: {
  communityId: string;
  channelId: string;
  userId: string;
  /** What the page already knows, shown while the card loads. */
  person?: CommunityPersona;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const cardId = useId();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [starting, startDm] = useTransition();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef<AbortController | undefined>(undefined);
  const closeSelf = useRef<() => void>(() => undefined);

  const close = useCallback((returnFocus = false) => {
    if (closeOpenCard === closeSelf.current) closeOpenCard = undefined;
    clearTimeout(timer.current);
    request.current?.abort();
    setOpen(false);
    setPinned(false);
    setPosition(null);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  function show(pin: boolean) {
    clearTimeout(timer.current);
    if (pin) setPinned(true);
    if (open) return;
    if (closeOpenCard && closeOpenCard !== closeSelf.current) closeOpenCard();
    closeOpenCard = closeSelf.current;
    setOpen(true);
    setLoaded({ status: "loading" });
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const url = `/community/${encodeURIComponent(communityId)}/channel/${encodeURIComponent(channelId)}/people/${encodeURIComponent(userId)}`;
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        setLoaded(response.ok ? { status: "ok", card: (await response.json()) as Card } : { status: "gone" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ status: "gone" });
      });
  }

  useEffect(() => {
    closeSelf.current = () => close();
  }, [close]);

  // Beside the name: below when it fits, otherwise above; never past an edge.
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const card = cardRef.current;
    if (!trigger || !card) return;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(CARD_WIDTH, viewportWidth - 2 * MARGIN);
    // A name that wraps onto two lines: anchor to the part that was hovered
    // or clicked last, which is the first rectangle in practice.
    const rect = trigger.getClientRects()[0] ?? trigger.getBoundingClientRect();
    const height = card.offsetHeight;
    const below = rect.bottom + GAP;
    const fitsBelow = below + height <= viewportHeight - MARGIN;
    const top = fitsBelow || rect.top - GAP - height < MARGIN ? below : rect.top - GAP - height;
    const left = Math.max(MARGIN, Math.min(rect.left, viewportWidth - width - MARGIN));
    setPosition((current) =>
      current && current.top === top && current.left === left && current.width === width ? current : { top, left, width },
    );
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, loaded, place]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(wrapperRef.current?.contains(document.activeElement) ?? false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, close, place]);

  useEffect(() => () => {
    clearTimeout(timer.current);
    request.current?.abort();
  }, []);

  function hoverIn(event: React.PointerEvent) {
    if (event.pointerType !== "mouse") return;
    clearTimeout(timer.current);
    if (!open) timer.current = setTimeout(() => show(false), HOVER_OPEN_MS);
  }

  function hoverOut(event: React.PointerEvent) {
    if (event.pointerType !== "mouse") return;
    clearTimeout(timer.current);
    if (!pinned) timer.current = setTimeout(() => close(), HOVER_CLOSE_MS);
  }

  function sendMessage(card: Card) {
    if (!card.dm) return;
    if (card.dm.conversationId) {
      router.push(`/community/${encodeURIComponent(communityId)}/messages/${encodeURIComponent(card.dm.conversationId)}`);
      return;
    }
    const form = new FormData();
    form.set("communityId", communityId);
    form.set("recipientId", card.id);
    startDm(() => startDirectConversationAction(form));
  }

  const shown = loaded.status === "ok" ? loaded.card : undefined;
  const face = shown
    ? { id: shown.id, name: shown.name, initials: shown.initials, avatarUrl: shown.avatarUrl ?? undefined, communityId }
    : person;

  return (
    <span
      ref={wrapperRef}
      className="inline"
      onPointerEnter={hoverIn}
      onPointerLeave={hoverOut}
      onBlur={(event) => {
        if (!wrapperRef.current?.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        aria-label={ariaLabel}
        onClick={(event) => {
          event.preventDefault();
          if (open && pinned) close();
          else show(true);
        }}
        className={cn("cursor-pointer text-left", className)}
      >
        {children}
      </button>
      {open ? (
        <span
          ref={cardRef}
          id={cardId}
          role="dialog"
          aria-label={face?.name ?? t("profileCard.label")}
          className="fixed z-50 block whitespace-normal rounded-[6px] border border-line-2 bg-surface p-3.5 text-left shadow-[0_8px_24px_rgba(23,25,26,0.14)]"
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            width: position?.width ?? CARD_WIDTH,
            visibility: position ? "visible" : "hidden",
          }}
        >
          {loaded.status === "gone" ? (
            <span className="block text-[13px] leading-snug text-ink-3">{t("profileCard.unavailable")}</span>
          ) : (
            <>
              <span className="flex items-center gap-3">
                {face ? <Avatar user={face} size="md" /> : null}
                <span className="min-w-0">
                  <span className="block truncate text-[0.9375rem] font-medium leading-snug text-ink">
                    {face?.name}
                  </span>
                  <span className="block truncate text-[12px] leading-snug text-ink-3">
                    {shown?.communityName ?? " "}
                  </span>
                </span>
              </span>
              {loaded.status === "loading" ? (
                <span className="mt-2.5 block text-[12px] text-ink-3">{t("profileCard.loading")}</span>
              ) : null}
              {shown?.bio ? (
                <span className="mt-2.5 block whitespace-pre-line break-words text-[13px] leading-relaxed text-ink-2 line-clamp-5">
                  {shown.bio}
                </span>
              ) : null}
              {shown?.dm ? (
                <button
                  type="button"
                  onClick={() => sendMessage(shown)}
                  disabled={starting}
                  className="mt-3 inline-flex h-8 items-center rounded-[5px] border border-line-2 px-3 text-[13px] font-medium text-ink transition-colors hover:bg-paper-2 disabled:opacity-50"
                >
                  {t("common.sendMessage")}
                </button>
              ) : null}
            </>
          )}
        </span>
      ) : null}
    </span>
  );
}
