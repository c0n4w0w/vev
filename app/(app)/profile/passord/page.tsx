import { redirect } from "next/navigation";
import { accountPath } from "@/lib/account-locale";
import { parseLocale } from "@/lib/i18n";

/** Existing bookmarks now open the same controls on the account page. */
export default async function AccountPasswordPage({ searchParams }: PageProps<"/profile/passord">) {
  redirect(accountPath("/profile?edit=password#login", parseLocale((await searchParams).locale)));
}
