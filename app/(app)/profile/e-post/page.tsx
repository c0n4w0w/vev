import { redirect } from "next/navigation";
import { accountPath } from "@/lib/account-locale";
import { parseLocale } from "@/lib/i18n";

/** Existing bookmarks now open the same controls on the account page. */
export default async function AccountEmailPage({ searchParams }: PageProps<"/profile/e-post">) {
  redirect(accountPath("/profile?edit=email#login", parseLocale((await searchParams).locale)));
}
