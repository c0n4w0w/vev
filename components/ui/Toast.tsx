"use client";

import { useEffect, useState } from "react";

/**
 * Brief confirmation after an action ("Samtalen er arkivert."): a quiet pill
 * near the bottom of the screen, read out politely by screen readers, gone
 * after a few seconds. One host lives in the app shell, so the message
 * survives the navigation the action may cause.
 */
const EVENT = "ting:toast";

export function showToast(text: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: text }));
}

export function ToastHost() {
  const [toast, setToast] = useState<{ text: string; key: number } | undefined>(undefined);

  useEffect(() => {
    function onToast(event: Event) {
      setToast({ text: (event as CustomEvent<string>).detail, key: Date.now() });
    }
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 lg:bottom-6"
    >
      {toast ? (
        <p
          key={toast.key}
          className="max-w-sm rounded-[6px] bg-ink px-4 py-2.5 text-center text-[13px] text-paper shadow-lg"
        >
          {toast.text}
        </p>
      ) : null}
    </div>
  );
}
