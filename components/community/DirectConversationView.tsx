"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Avatar, cn } from "@/components/ui/primitives";
import { IconArrowLeft, IconSend } from "@/components/ui/icons";
import { createDirectMessageAction } from "@/app/actions";
import { emptyDirectMessageFormState } from "@/lib/direct-message-form";
import { dayHeading, formatTime, isSameDay } from "@/lib/format";
import type { Community, DirectConversation, User } from "@/lib/types";

export function DirectConversationView({
  conversation,
  community,
  currentUser,
}: {
  conversation: DirectConversation;
  community: Community;
  currentUser: User;
}) {
  const [messages, setMessages] = useState(conversation.messages);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const people = useMemo(
    () => ({
      [currentUser.id]: currentUser,
      [conversation.otherParticipant.id]: conversation.otherParticipant,
    }),
    [conversation.otherParticipant, currentUser],
  );

  function send() {
    const body = draft.trim();
    if (!body || pending) return;

    const pendingId = `pending-${Date.now()}`;
    setMessages((current) => [
      ...current,
      {
        id: pendingId,
        conversationId: conversation.id,
        authorId: currentUser.id,
        body,
        createdAt: new Date().toISOString(),
      },
    ]);
    setDraft("");
    setError(undefined);
    composerRef.current?.focus();

    const form = new FormData();
    form.set("communityId", community.id);
    form.set("conversationId", conversation.id);
    form.set("body", body);

    startTransition(async () => {
      const result = await createDirectMessageAction(emptyDirectMessageFormState, form);
      if (result.status === "ok") {
        setMessages((current) =>
          current.map((message) => (message.id === pendingId ? result.message : message)),
        );
        return;
      }
      setMessages((current) => current.filter((message) => message.id !== pendingId));
      setError(result.status === "error" ? result.error : undefined);
      setDraft((current) => current || body);
    });
  }

  return (
    <div className="flex h-full min-h-[calc(100dvh-3.25rem)] flex-col lg:min-h-dvh">
      <header className="sticky top-[3.25rem] z-20 border-b border-line bg-surface/95 px-5 py-3.5 backdrop-blur-sm lg:top-0 lg:px-8">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Link
            href={`/community/${community.id}/messages`}
            className="-ml-1 rounded-[5px] p-1.5 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
            aria-label="Tilbake til meldinger"
          >
            <IconArrowLeft size={18} />
          </Link>
          <Avatar user={conversation.otherParticipant} size="sm" />
          <div className="min-w-0">
            <h1 className="truncate text-[0.9375rem] font-medium text-ink">
              {conversation.otherParticipant.name}
            </h1>
            <p className="truncate text-[12px] text-ink-3">{community.name}</p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-5 py-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          {messages.length === 0 ? (
            <div className="rounded-[6px] border border-dashed border-line-2 bg-surface/60 px-6 py-12 text-center">
              <h2 className="font-display text-lg text-ink">
                Start samtalen med {conversation.otherParticipant.name}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
                Meldingen lagres i {community.name} og er bare synlig for dere to så lenge dere
                har tilgang til fellesskapet.
              </p>
            </div>
          ) : (
            <ol className="space-y-1">
              {messages.map((message, index) => {
                const previous = messages[index - 1];
                const author = people[message.authorId];
                const mine = message.authorId === currentUser.id;
                const newDay = !previous || !isSameDay(previous.createdAt, message.createdAt);
                const grouped =
                  !newDay &&
                  previous?.authorId === message.authorId &&
                  Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 10 * 60_000;

                return (
                  <li key={message.id}>
                    {newDay ? (
                      <div className="flex items-center gap-3 pb-3 pt-6 first:pt-0">
                        <span className="h-px flex-1 bg-line" />
                        <span className="label">{dayHeading(message.createdAt)}</span>
                        <span className="h-px flex-1 bg-line" />
                      </div>
                    ) : null}

                    <div
                      className={cn(
                        "group flex gap-3",
                        grouped ? "mt-1" : "mt-4",
                        mine && "flex-row-reverse",
                      )}
                    >
                      <div className="w-9 shrink-0">
                        {grouped ? (
                          <span
                            className={cn(
                              "mt-1 hidden text-[10px] tabular-nums text-ink-3 group-hover:block",
                              mine && "text-right",
                            )}
                          >
                            {formatTime(message.createdAt)}
                          </span>
                        ) : author ? (
                          <Avatar user={author} size="sm" />
                        ) : null}
                      </div>

                      <div className={cn("min-w-0 max-w-[min(34rem,78%)]", mine && "text-right")}>
                        {!grouped ? (
                          <p
                            className={cn(
                              "mb-1 flex items-baseline gap-2",
                              mine && "justify-end",
                            )}
                          >
                            <span className="text-sm font-medium text-ink">
                              {author?.name ?? "Ukjent"}
                            </span>
                            <span className="text-[11px] text-ink-3">
                              {formatTime(message.createdAt)}
                            </span>
                          </p>
                        ) : null}

                        <p
                          className={cn(
                            "whitespace-pre-line rounded-[6px] px-3 py-2 text-[0.9375rem] leading-[1.55]",
                            mine
                              ? "bg-skog text-white"
                              : "border border-line bg-surface text-ink-2",
                          )}
                        >
                          {message.body}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-line bg-paper/95 px-5 py-4 backdrop-blur-sm lg:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-3 rounded-[6px] border border-line-2 bg-surface p-2 focus-within:border-ink-3">
            <Avatar user={currentUser} size="sm" className="mb-0.5" />
            <textarea
              ref={composerRef}
              rows={1}
              value={draft}
              maxLength={4000}
              onChange={(event) => {
                setDraft(event.target.value);
                const el = event.target;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={`Skriv til ${conversation.otherParticipant.name}`}
              className="max-h-44 min-h-[2.25rem] flex-1 resize-none bg-transparent py-2 text-[0.9375rem] leading-6 text-ink outline-none placeholder:text-ink-3"
            />
            <button
              type="button"
              onClick={send}
              disabled={!draft.trim() || pending}
              aria-label="Send melding"
              className="mb-0.5 rounded-[5px] p-2 text-white transition-opacity disabled:opacity-30"
              style={{ backgroundColor: community.branding.accent }}
            >
              <IconSend size={17} />
            </button>
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-[11px] text-rust">
              {error}
            </p>
          ) : null}
          <p className="mt-2 text-[11px] text-ink-3">
            Direkte meldinger er beskyttet av tilgangskontroll i TING. De er ikke ende-til-ende-kryptert.
          </p>
        </div>
      </div>
    </div>
  );
}
