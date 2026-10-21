"use server";

import { revalidatePath } from "next/cache";
import { isLocale, parseLocale } from "@/lib/i18n";
import { getRequestTranslator } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type LanguageState = { status: "idle" | "saved" } | { status: "error"; message: string };

export async function saveLanguagePreferenceAction(_state: LanguageState, formData: FormData): Promise<LanguageState> {
  const t = await getRequestTranslator(parseLocale(formData.get("locale")));
  const choice = formData.get("preference");
  if (!isLocale(choice)) return { status: "error", message: t("account.language.error") };
  if (!(await getSessionUser())) return { status: "error", message: t("account.language.signedOut") };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("set_my_locale", { p_locale: choice });
    if (error || data !== choice) return { status: "error", message: t("account.language.error") };
  } catch {
    return { status: "error", message: t("account.language.error") };
  }
  revalidatePath("/", "layout");
  return { status: "saved" };
}
