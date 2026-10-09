"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A native modal dialog: focus moves into it, Escape and the backdrop close
 * it, and the rest of the page is inert while it is open. Opening and closing
 * are driven by `open`; `onClose` fires however it was dismissed.
 */
export function ConfirmDialog({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-[8px] border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-ink/30"
    >
      <div className="p-5">{children}</div>
    </dialog>
  );
}
