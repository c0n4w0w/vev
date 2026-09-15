"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/components/ui/primitives";
import { IconCheck } from "@/components/ui/icons";
import { setMyLocalGroupAction } from "@/app/actions";
import { emptyLocalGroupFormState } from "@/lib/local-group-form";
import type { LocalGroup } from "@/lib/types";

function Save({ accent, label }: { accent: string; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
      style={{ backgroundColor: accent }}
    >
      {pending ? "Lagrer …" : label}
    </button>
  );
}

/**
 * Stores "no local group".
 *
 * Its field is deliberately *not* `localGroupId`. A submit button contributes
 * its own name and value to the submission, so sharing the radios' name put
 * two `localGroupId` entries in the FormData — the checked radio first, then
 * this one — and `get()` returns the first. Clearing an existing affiliation
 * therefore re-saved it. A separate field cannot collide with the radios
 * whatever is selected.
 */
function Skip({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="clear"
      value="1"
      disabled={pending}
      className="h-10 rounded-[5px] border border-line-2 px-4 text-sm text-ink-2 transition-colors hover:border-ink-3 disabled:opacity-40"
    >
      {label}
    </button>
  );
}

/**
 * Choosing, changing or clearing a local group.
 *
 * Skipping is a submission like any other — it stores "no group", which is a
 * real answer rather than an abandoned form. That is why there is no
 * "Vet ikke" option: not choosing *is* the answer, and it is kept as the
 * absence of a selection rather than as a value that would later have to be
 * interpreted.
 */
export function LocalGroupPicker({
  communityId,
  groups,
  selectedId,
  accent,
  memberCounts,
  welcome,
}: {
  communityId: string;
  /** Active groups only — a retired one cannot be newly chosen. */
  groups: LocalGroup[];
  selectedId?: string;
  accent: string;
  /** Keyed by group id; every group has an entry, zero included. */
  memberCounts: Map<string, number>;
  /** First visit straight after joining. */
  welcome?: boolean;
}) {
  const [state, formAction] = useActionState(setMyLocalGroupAction, emptyLocalGroupFormState);
  const [choice, setChoice] = useState<string>(selectedId ?? "");

  return (
    <form action={formAction}>
      <input type="hidden" name="communityId" value={communityId} />

      <ul className="grid gap-2 sm:grid-cols-2">
        {groups.map((group) => {
          const count = memberCounts.get(group.id);
          const active = choice === group.id;
          return (
            <li key={group.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-[6px] border p-3.5 transition-colors",
                  active ? "border-transparent" : "border-line hover:border-line-2",
                )}
                style={active ? { backgroundColor: `${accent}12`, borderColor: accent } : undefined}
              >
                <input
                  type="radio"
                  name="localGroupId"
                  value={group.id}
                  checked={active}
                  onChange={() => setChoice(group.id)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    active ? "border-transparent text-white" : "border-line-2",
                  )}
                  style={active ? { backgroundColor: accent } : undefined}
                >
                  {active ? <IconCheck size={13} /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[0.9375rem] text-ink">{group.name}</span>
                  {count !== undefined ? (
                    <span className="block text-[12px] text-ink-3">
                      {count} {count === 1 ? "medlem" : "medlemmer"}
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Save accent={accent} label={selectedId ? "Lagre endring" : "Lagre lokallag"} />
        <Skip label={selectedId ? "Fjern lokallag" : "Jeg vil ikke velge lokallag nå"} />
      </div>

      <p className="mt-3 text-[12px] text-ink-3">
        Du kan velge eller endre lokallag senere.
        {welcome ? " Du er allerede medlem — dette er kun et tillegg." : ""}
      </p>

      {state.status === "error" ? (
        <p role="alert" className="mt-3 text-[13px] text-rust">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
