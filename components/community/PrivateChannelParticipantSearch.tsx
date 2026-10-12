"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { searchPrivateChannelCandidatesAction } from "@/app/actions";
import { IconSearch } from "@/components/ui/icons";
import { useT } from "@/lib/i18n/react";
import type { PrivateChannelCandidate } from "@/lib/private-channel-form";

/**
 * Finds members of one lokallag to put in a private channel.
 *
 * Searching, not listing: the database answers with at most ten display names
 * for at least two typed characters, and only to someone who may create a
 * channel under this lokallag or manage this channel, so this never holds the
 * lokallag's roster. What happens to a match is the caller's business —
 * `renderAction` draws the button next to each one.
 */
export function PrivateChannelParticipantSearch({
  inputId,
  localGroupId,
  localGroupName,
  channelId,
  excludeIds,
  renderAction,
}: {
  inputId: string;
  localGroupId: string;
  localGroupName: string;
  /** Set when adding to an existing channel; omitted while creating one. */
  channelId?: string;
  /** People already chosen or already in the channel: never offered again. */
  excludeIds: string[];
  renderAction: (candidate: PrivateChannelCandidate) => ReactNode;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ term: string; matches: PrivateChannelCandidate[] } | null>(null);
  // Only the answer to the latest question is shown.
  const latest = useRef(0);

  const term = query.trim();
  const searchable = term.length >= 2;

  useEffect(() => {
    if (!searchable) return;
    const request = ++latest.current;
    const timer = setTimeout(async () => {
      const matches = await searchPrivateChannelCandidatesAction({ localGroupId, query: term, channelId });
      if (request === latest.current) setFound({ term, matches });
    }, 250);
    return () => clearTimeout(timer);
  }, [term, searchable, localGroupId, channelId]);

  const current = searchable && found?.term === term ? found.matches : null;
  const matches = (current ?? []).filter((candidate) => !excludeIds.includes(candidate.userId));

  return (
    <div className="space-y-2">
      <label className="sr-only" htmlFor={inputId}>
        {t("privateChannel.search.label")}
      </label>
      <div className="relative">
        <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          // Inside the create form, Enter would otherwise submit the form.
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          maxLength={80}
          autoComplete="off"
          placeholder={t("privateChannel.search.placeholder")}
          className="h-10 w-full rounded-[5px] border border-line-2 bg-surface pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
        />
      </div>

      {searchable ? (
        current === null ? (
          <p className="text-[13px] text-ink-3">{t("privateChannel.search.searching")}</p>
        ) : matches.length > 0 ? (
          <ul className="space-y-1.5" aria-label={t("privateChannel.search.results")}>
            {matches.map((candidate) => (
              <li
                key={candidate.userId}
                className="flex items-center gap-3 rounded-[5px] border border-line px-3 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{candidate.displayName}</span>
                {renderAction(candidate)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-3">
            {t("privateChannel.search.noMatches", { name: localGroupName })}
          </p>
        )
      ) : null}
    </div>
  );
}
