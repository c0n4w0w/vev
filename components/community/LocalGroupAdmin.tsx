"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Badge, Panel } from "@/components/ui/primitives";
import {
  createLocalGroupAction,
  renameLocalGroupAction,
  setLocalGroupActiveAction,
} from "@/app/actions";
import { emptyLocalGroupFormState } from "@/lib/local-group-form";
import type { LocalGroup } from "@/lib/types";

function Pending({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return <>{pending ? "…" : children}</>;
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
 */
export function LocalGroupAdmin({
  communityId,
  groups,
  memberCounts,
}: {
  communityId: string;
  /** Every group, retired ones included. */
  groups: LocalGroup[];
  memberCounts: Map<string, number>;
}) {
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
            <Panel as="li" key={group.id} className="flex flex-wrap items-center gap-3 p-3.5">
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
                    <Pending>Lagre</Pending>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(undefined)}
                    className="h-9 rounded-[5px] px-3 text-[13px] text-ink-3"
                  >
                    Avbryt
                  </button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] text-ink">{group.name}</span>
                    <span className="block text-[12px] text-ink-3">
                      {count} {count === 1 ? "medlem" : "medlemmer"}
                    </span>
                  </span>

                  {group.active ? null : <Badge tone="neutral">Avviklet</Badge>}

                  <button
                    type="button"
                    onClick={() => setEditing(group.id)}
                    className="h-9 rounded-[5px] border border-line-2 px-3 text-[13px] text-ink-2 transition-colors hover:border-ink-3"
                  >
                    Endre navn
                  </button>

                  <form action={activeAction}>
                    <input type="hidden" name="communityId" value={communityId} />
                    <input type="hidden" name="localGroupId" value={group.id} />
                    {group.active ? null : <input type="hidden" name="active" value="on" />}
                    <button
                      type="submit"
                      className="h-9 rounded-[5px] border border-line-2 px-3 text-[13px] text-ink-2 transition-colors hover:border-ink-3"
                    >
                      <Pending>{group.active ? "Avvikle" : "Gjenopprett"}</Pending>
                    </button>
                  </form>
                </>
              )}
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
          placeholder="Nytt lokallag"
          maxLength={80}
          className="h-10 min-w-0 flex-1 rounded-[5px] border border-line-2 bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
        />
        <button
          type="submit"
          className="h-10 rounded-[5px] border border-line-2 px-4 text-sm text-ink-2 transition-colors hover:border-ink-3"
        >
          <Pending>Legg til</Pending>
        </button>
      </form>

      {createState.status === "error" ? (
        <p role="alert" className="text-[13px] text-rust">
          {createState.error}
        </p>
      ) : null}

      <p className="text-[12px] leading-relaxed text-ink-3">
        Et avviklet lokallag kan ikke velges av nye medlemmer, men de som allerede er tilknyttet
        beholder det. Lokallag slettes ikke.
      </p>
    </div>
  );
}
