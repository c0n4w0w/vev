import "server-only";
import { cookies } from "next/headers";
import { isLocale, parseLocale, type Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";

const COOKIE = "ting-auth-locale";

/** Emailed account links have no community context. Remember presentation only. */
export async function rememberAuthLocale(locale: Locale) {
  (await cookies()).set(COOKIE, locale, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60,
  });
}

export async function authLocale(explicit?: unknown): Promise<Locale> {
  return getRequestLocale(isLocale(explicit) ? explicit : parseLocale((await cookies()).get(COOKIE)?.value));
}
