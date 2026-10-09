"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Badge, Panel } from "@/components/ui/primitives";
import {
  addLocalGroupLeaderAction,
  createLocalGroupAction,
  removeLocalGroupLeaderAction,
  renameLocalGroupAction,
  setLocalGroupActiveAction,
} from "@/app/actions";
import { tn } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/react";
import {
  emptyLocalGroupFormState,
  emptyLocalGroupLeaderFormState,
} from "@/lib/local-group-form";
import type { LocalGroup, LocalGroupLeadership } from "@/lib/types";

function Pending({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return <>{pending ? "…" : children}</>;
}

const smallButton =
  "h-8 rounded-[5px] border border-line-2 px-3 text-[13px] text-ink-2 transition-colors hover:border-ink-3";

/**
 * One leader: their name, and a remove action that asks first. Removing is
 * immediate in the database — the person loses event management at once — so
 * a stray click should not do it.
 */
function LeaderChip({
  communityId,
  localGroupId,
  leader,
  removeAction,
}: {
  communityId: string;
  localGroupId: string;
  leader: { userId: string; name: string };
  removeAction: (formData: FormData) => void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <li>
        <form
          action={removeAction}
          className="flex flex-wrap items-center gap-2 rounded-[5px] border border-line-2 px-2.5 py-1"
        >
          <input type="hidden" name="communityId" value={communityId} />
          <input type="hidden" name="localGroupId" value={localGroupId} />
          <input type="hidden" name="userId" value={leader.userId} />
          <span className="text-[13px] text-ink">
            {t("lokallag.leaders.confirmRemove", { name: leader.name })}
          </span>
          <button type="submit" className="text-[13px] font-medium text-rust transition-opacity hover:opacity-70">
            <Pending>{t("common.yes")}</Pending>
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-[13px] text-ink-3 transition-colors hover:text-ink"
          >
            {t("common.no")}
          </button>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 rounded-[5px] border border-line px-2.5 py-1">
      <span className="text-[13px] text-ink">{leader.name}</span>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={t("lokallag.leaders.removeNamed", { name: leader.name })}
        className="text-[12px] text-ink-3 transition-colors hover:text-rust"
      >
        {t("lokallag.leaders.remove")}
      </button>
    </li>
  );
}

/**
 * Who leads one lokallag, under its name. Appointing offers only active
 * members of exactly this lokallag who are not leaders already; the database
 * refuses anyone else whatever the form sends.
 */
function LeaderControls({
  communityId,
  group,
  leadership,
}: {
  communityId: string;
  group: LocalGroup;
  leadership: LocalGroupLeadership;
}) {
  const t = useT();
  const [addState, addAction] = useActionState(addLocalGroupLeaderAction, emptyLocalGroupLeaderFormState);
  const [removeState, removeAction] = useActionState(
    removeLocalGroupLeaderAction,
    emptyLocalGroupLeaderFormState,
  );
  const [adding, setAdding] = useState(false);

  // The latest outcome of either form, so feedback sits in one place.
  const [last, setLast] = useState<typeof addState>(addState);
  const [seenAdd, setSeenAdd] = useState(addState);
  const [seenRemove, setSeenRemove] = useState(removeState);
  if (addState !== seenAdd) {
    setSeenAdd(addState);
    setLast(addState);
    if (addState.status === "ok") setAdding(false);
  }
  if (removeState !== seenRemove) {
    setSeenRemove(removeState);
    setLast(removeState);
  }

  const headingId = `leaders-${group.id}`;

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p id={headingId} className="label mb-2">
        {t("lokallag.leaders.heading")}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {leadership.leaders.length > 0 ? (
          <ul className="flex flex-wrap items-center gap-2" aria-labelledby={headingId}>
            {leadership.leaders.map((leader) => (
              <LeaderChip
                key={leader.userId}
                communityId={communityId}
                localGroupId={group.id}
                leader={leader}
                removeAction={removeAction}
              />
            ))}
          </ul>
        ) : (
          <span className="text-[13px] text-ink-3">{t("lokallag.leaders.none")}</span>
        )}

        {adding ? null : (
          <button type="button" onClick={() => setAdding(true)} className={smallButton}>
            {t("lokallag.leaders.add")}
          </button>
        )}
      </div>

      {adding ? (
        leadership.candidates.length > 0 ? (
          <form action={addAction} className="mt-2 flex flex-wrap items-center gap-2">
            <input type="hidden" name="communityId" value={communityId} />
            <input type="hidden" name="localGroupId" value={group.id} />
            <select
              name="userId"
              required
              defaultValue=""
              aria-label={t("lokallag.leaders.pick", { name: group.name })}
              className="h-8 min-w-0 flex-1 rounded-[5px] border border-line-2 bg-surface px-2 text-[13px] text-ink outline-none focus:border-ink-3"
            >
              <option value="" disabled>
                {t("lokallag.leaders.pick", { name: group.name })}
              </option>
              {leadership.candidates.map((candidate) => (
                <option key={candidate.userId} value={candidate.userId}>
                  {candidate.name}
                </option>
              ))}
            </select>
            <button type="submit" className={smallButton}>
              <Pending>{t("lokallag.leaders.appoint")}</Pending>
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="h-8 rounded-[5px] px-2 text-[13px] text-ink-3"
            >
              {t("common.cancel")}
            </button>
          </form>
        ) : (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
            {t("lokallag.leaders.noCandidates", { name: group.name })}
            <button type="button" onClick={() => setAdding(false)} className="text-ink-2 hover:text-ink">
              {t("common.cancel")}
            </button>
          </p>
        )
      ) : null}

      {last.status === "ok" ? (
        <p role="status" className="mt-2 text-[13px] text-ink-2">
          {last.message}
        </p>
      ) : last.status === "error" ? (
        <p role="alert" className="mt-2 text-[13px] text-rust">
          {last.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Administration of the community's local groups.
 *
 * Deliberately small. Creating, renaming and retiring covers what an
 * organisation actually does between annual meetings; anything more belongs in
 * a conversation about what local groups are *for*, not in this panel.
 *
 * There is no delete. A group people belong to cannot be removed without
 * removing something that belongs to them, so retiring it is the operation:
 * the name survives, the members keep it, and nobody new can choose it.
 *
 * Each active group also shows its lokallagsledere — the people who may
 * create and manage that group's events — with appoint and remove. A retired
 * group has none: retiring ends every appointment.
 */
export function LocalGroupAdmin({
  communityId,
  groups,
  memberCounts,
  leadership,
}: {
  communityId: string;
  /** Every group, retired ones included. */
  groups: LocalGroup[];
  memberCounts: Map<string, number>;
  /** Leaders and appointable members per group id. */
  leadership: Map<string, LocalGroupLeadership>;
}) {
  const t = useT();
  const locale = useLocale();
  const [createState, createAction] = useActionState(
    createLocalGroupAction,
    emptyLocalGroupFormState,
  );
  const [renameState, renameAction] = useActionState(
    renameLocalGroupAction,
    emptyLocalGroupFormState,
  );
  const [, activeAction] = useActionState(setLocalGroupActiveAction, emptyLocalGroupFormState);
  const [editing, setEditing] = useState<string | undefined>(undefined);

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {groups.map((group) => {
          const count = memberCounts.get(group.id) ?? 0;
          return (
            <Panel as="li" key={group.id} className="p-3.5">
              <div className="flex flex-wrap items-center gap-3">
                {editing === group.id ? (
                  <form action={renameAction} className="flex flex-1 flex-wrap items-center gap-2">
                    <input type="hidden" name="communityId" value={communityId} />
                    <input type="hidden" name="localGroupId" value={group.id} />
                    <input
                      name="name"
                      defaultValue={group.name}
                      autoFocus
                      maxLength={80}
                      className="h-9 min-w-0 flex-1 rounded-[5px] border border-line-2 bg-surface px-3 text-sm text-ink outline-none focus:border-ink-3"
                    />
                    <button type="submit" className="h-9 rounded-[5px] border border-line-2 px-3 text-[13px] text-ink-2">
                      <Pending>{t("common.save")}</Pending>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(undefined)}
                      className="h-9 rounded-[5px] px-3 text-[13px] text-ink-3"
                    >
                      {t("common.cancel")}
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9375rem] text-ink">{group.name}</span>
                      <span className="block text-[12px] text-ink-3">
                        {tn(locale, "count.members", count)}
                      </span>
                    </span>

                    {group.active ? null : <Badge tone="neutral">{t("lokallag.retiredBadge")}</Badge>}

                    <button
                      type="button"
                      onClick={() => setEditing(group.id)}
                      className="h-9 rounded-[5px] border border-line-2 px-3 text-[13px] text-ink-2 transition-colors hover:border-ink-3"
                    >
                      {t("lokallag.rename")}
                    </button>

                    <form action={activeAction}>
                      <input type="hidden" name="communityId" value={communityId} />
                      <input type="hidden" name="localGroupId" value={group.id} />
                      {group.active ? null : <input type="hidden" name="active" value="on" />}
                      <button
                        type="submit"
                        className="h-9 rounded-[5px] border border-line-2 px-3 text-[13px] text-ink-2 transition-colors hover:border-ink-3"
                      >
                        <Pending>{group.active ? t("lokallag.retire") : t("lokallag.restore")}</Pending>
                      </button>
                    </form>
                  </>
                )}
              </div>
              {group.active ? (
                <LeaderControls
                  communityId={communityId}
                  group={group}
                  leadership={leadership.get(group.id) ?? { leaders: [], candidates: [] }}
                />
              ) : null}
            </Panel>
          );
        })}
      </ul>

      {renameState.status === "error" ? (
        <p role="alert" className="text-[13px] text-rust">
          {renameState.error}
        </p>
      ) : null}

      <form action={createAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="communityId" value={communityId} />
        <input
          name="name"
          placeholder={t("lokallag.newPlaceholder")}
          maxLength={80}
          className="h-10 min-w-0 flex-1 rounded-[5px] border border-line-2 bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
        />
        <button
          type="submit"
          className="h-10 rounded-[5px] border border-line-2 px-4 text-sm text-ink-2 transition-colors hover:border-ink-3"
        >
          <Pending>{t("lokallag.add")}</Pending>
        </button>
      </form>

      {createState.status === "error" ? (
        <p role="alert" className="text-[13px] text-rust">
          {createState.error}
        </p>
      ) : null}

      <p className="text-[12px] leading-relaxed text-ink-3">
        {t("lokallag.retiredNote")}
      </p>
      <p className="text-[12px] leading-relaxed text-ink-3">
        {t("lokallag.leaders.note")}
      </p>
    </div>
  );
}
