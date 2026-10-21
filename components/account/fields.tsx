"use client";

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/primitives";

export const inputClass =
  "mt-2 h-11 w-full rounded-[5px] border border-line-2 bg-surface px-3 text-[0.9375rem] text-ink transition-colors placeholder:text-ink-3 focus:border-ink-3";

/** A labelled input in the account forms. */
export function Field({
  label,
  hint,
  id,
  ...input
}: { label: string; hint?: string; id: string } & ComponentProps<"input">) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} className={inputClass} aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({ label, working }: { label: ReactNode; working: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
      {pending ? working : label}
    </Button>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-[5px] border border-rust/25 bg-rust-soft px-3 py-2 text-[13px] leading-relaxed text-rust"
    >
      {children}
    </p>
  );
}
