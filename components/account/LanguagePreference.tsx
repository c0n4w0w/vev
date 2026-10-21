"use client";

import { useActionState, useTransition } from "react";
import { saveLanguagePreferenceAction, type LanguageState } from "@/app/language-actions";
import { FormError } from "@/components/account/fields";
import { LOCALES, type Locale } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/react";

export function LanguagePreference({ preference }: { preference?: Locale }) {
  const locale = useLocale();
  const t = useT();
  const [state, action, pending] = useActionState(async (previous: LanguageState, form: FormData): Promise<LanguageState> => {
    try {
      return await saveLanguagePreferenceAction(previous, form);
    } catch {
      return { status: "error", message: t("account.language.error") };
    }
  }, { status: "idle" });
  const [, startTransition] = useTransition();

  function choose(choice: Locale) {
    if (pending) return;
    const form = new FormData();
    form.set("preference", choice);
    form.set("locale", locale);
    startTransition(() => action(form));
  }

  return (
    <section className="mt-7 border-t border-line pt-6">
      <fieldset aria-busy={pending}>
        <legend className="label mb-3">{t("account.language")}</legend>
        <div className="flex flex-wrap gap-2">
          {LOCALES.map((choice) => (
            <label key={choice} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[5px] border border-line-2 bg-surface px-3 py-2 text-sm text-ink has-checked:border-skog has-checked:bg-skog-soft has-checked:text-skog has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-skog">
              <input
                type="radio"
                name="language"
                value={choice}
                lang={choice}
                checked={(preference ?? locale) === choice}
                aria-disabled={pending}
                onChange={() => choose(choice)}
                // Choosing the already displayed default must also make it an
                // explicit preference, including with Space on the radio.
                onClick={() => { if (!preference && choice === locale) choose(choice); }}
                className="h-4 w-4 accent-skog"
              />
              <span lang={choice}>{choice === "nb" ? "Norsk bokmål" : "English"}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-2 text-xs leading-relaxed text-ink-3" role="status" aria-live="polite">
        {pending ? t("account.language.saving") : state.status === "saved" ? t("account.language.saved") : null}
      </div>
      {state.status === "error" ? <div className="mt-2"><FormError>{state.message}</FormError></div> : null}
    </section>
  );
}
