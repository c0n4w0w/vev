"use client";

import { useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useT } from "@/lib/i18n/react";

/**
 * Pieces every channel and section dialog shares, so they look and behave as
 * the private-channel dialogs do: the same field, the same quiet cancel, a
 * submit button that cannot be pressed twice while its request is out.
 */

export const fieldClass =
  "h-10 w-full rounded-[5px] border border-line-2 bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3";

export const quietButtonClass =
  "h-8 rounded-[5px] border border-line-2 px-3 text-[13px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-40";

export function SubmitButton({
  label,
  pendingLabel,
  accent,
  danger,
  disabled,
}: {
  label: string;
  pendingLabel?: string;
  accent?: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-disabled={pending || disabled}
      className={
        danger
          ? "h-9 rounded-[5px] bg-rust px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          : "h-9 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40"
      }
      style={danger ? undefined : { backgroundColor: accent }}
    >
      {pending ? (pendingLabel ?? "…") : label}
    </button>
  );
}

export function CancelButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} className="h-9 rounded-[5px] px-3 text-sm text-ink-2 hover:bg-paper-2">
      {t("common.cancel")}
    </button>
  );
}

export function FormError({ state }: { state: { status: string; error?: string } }) {
  if (state.status !== "error" || !state.error) return null;
  return (
    <p role="alert" className="text-[13px] text-rust">
      {state.error}
    </p>
  );
}

/** Closes a dialog once its action has been confirmed by the database. */
export function useCloseOnSuccess(state: { status: string }, onClose: () => void) {
  useEffect(() => {
    if (state.status === "ok") onClose();
    // onClose is the owner's setter; only a new state should close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

/** A key for one create request, fresh each time its form is opened. */
export function newCreationKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "";
}

export type WriteAccess = "everyone" | "staff";

/**
 * "Hvem kan skrive i kanalen?" — the community channel's `read_only` flag, as
 * the create and edit dialogs ask it. Everyone who can read the channel keeps
 * reading it either way; the database enforces the choice on every write.
 */
export function WriteAccessField({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: WriteAccess;
  onChange: (value: WriteAccess) => void;
}) {
  const t = useT();
  const options: { value: WriteAccess; label: string; hint: string }[] = [
    { value: "everyone", label: t("channels.write.everyone"), hint: t("channels.write.everyoneHint") },
    { value: "staff", label: t("channels.write.staff"), hint: t("channels.write.staffHint") },
  ];
  return (
    <fieldset>
      <legend className="label mb-1.5">{t("channels.write.legend")}</legend>
      <div className="space-y-1.5">
        {options.map((option) => (
          <label
            key={option.value}
            htmlFor={`${idPrefix}-${option.value}`}
            className="flex cursor-pointer items-start gap-2.5 rounded-[5px] border border-line px-3 py-2 has-[:checked]:border-ink-3"
          >
            <input
              id={`${idPrefix}-${option.value}`}
              type="radio"
              name="writeAccess"
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-1"
            />
            <span className="min-w-0">
              <span className="block text-sm text-ink">{option.label}</span>
              <span className="block text-[12px] leading-snug text-ink-3">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
