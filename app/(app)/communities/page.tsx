import { redirect } from "next/navigation";

/** Retired directory; authentication is still enforced by the app layout. */
export default function CommunitiesPage() {
  redirect("/home");
}
