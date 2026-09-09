import Link from "next/link";
import { AcceptInvitation } from "@/components/community/AcceptInvitation";
import { Wordmark } from "@/components/shell/Wordmark";
import { CommunityMark, Panel, buttonClass } from "@/components/ui/primitives";
import { IconLock, IconMail } from "@/components/ui/icons";
import { getInvitationPreview, getPortalCommunity } from "@/lib/data";
import { formatFullDate } from "@/lib/format";
import { getSessionUser } from "@/lib/session";

export const metadata = { title: "Invitasjon" };

/**
 * Where an invitation link lands.
 *
 * The page can be opened by anyone holding the link, so it shows the least it
 * can: which community, and which address the invitation was sent to. No
 * member list, no counts, no mention of any other community — a visitor with
 * no account should not learn from this page that VEV hosts anything else.
 *
 * Holding the link is not enough to join. Accepting requires a session whose
 * email matches the invited address, which the database checks.
 */
export default async function InvitationPage({ params }: PageProps<"/invitasjon/[token]">) {
  const { token } = await params;
  const preview = await getInvitationPreview(token);
  const user = await getSessionUser();

  if (!preview) {
    return (
      <Shell>
        <h1 className="font-display text-[1.75rem] leading-tight text-ink">
          Invitasjonen er ikke gyldig
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">
          Lenken kan være brukt, trukket tilbake eller utløpt. Be den som inviterte deg om å sende
          en ny.
        </p>
        <Link href="/" className={`${buttonClass({ variant: "secondary" })} mt-8`}>
          Til forsiden
        </Link>
      </Shell>
    );
  }

  // Branding comes from the public portal record for the slug the preview
  // returned — the same data any visitor to that portal can see, and only for
  // the one community this invitation names.
  const community = await getPortalCommunity(preview.communitySlug);
  const accent = community?.branding.accent ?? "#1f4a3d";
  const signedInAs = user?.email?.toLowerCase();
  const matches = signedInAs === preview.email.toLowerCase();

  return (
    <Shell>
      <p className="label">Invitasjon</p>
      <p className="mt-4 text-[0.9375rem] text-ink-2">Du er invitert til</p>
      <div className="mt-3 flex items-center gap-3">
        {community ? <CommunityMark community={community} size="md" /> : null}
        <h1 className="font-display text-[2rem] leading-tight text-ink">
          {preview.communityName}
        </h1>
      </div>
      <p className="mt-2 text-[0.9375rem] text-ink-2">på VEV.</p>

      <Panel className="mt-8 p-5">
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-2">
          <IconMail size={14} className="mt-0.5 shrink-0 text-ink-3" />
          Invitasjonen er sendt til <span className="font-mono text-ink">{preview.email}</span>.
          Den gjelder fram til {formatFullDate(preview.expiresAt)} og kan brukes én gang.
        </p>
      </Panel>

      <div className="mt-6">
        {!user ? (
          <>
            <p className="mb-4 text-[0.9375rem] leading-relaxed text-ink-2">
              Logg inn med den adressen for å bli med. Har du ingen VEV-konto, blir den opprettet
              når du bruker innloggingslenken.
            </p>
            <Link
              href={`/login?e=${encodeURIComponent(preview.email)}&neste=${encodeURIComponent(`/invitasjon/${token}`)}`}
              className={buttonClass()}
            >
              Fortsett med {preview.email}
            </Link>
          </>
        ) : matches ? (
          <AcceptInvitation token={token} accent={accent} />
        ) : (
          <>
            <p className="mb-4 rounded-[5px] border border-rust/25 bg-rust-soft px-3 py-2.5 text-[13px] leading-relaxed text-rust">
              Du er logget inn som {signedInAs}, men invitasjonen er sendt til {preview.email}. Logg
              inn med den adressen for å bli med.
            </p>
            <Link href="/login" className={buttonClass({ variant: "secondary" })}>
              Bytt konto
            </Link>
          </>
        )}
      </div>

      <p className="mt-8 flex items-start gap-2 border-t border-line pt-5 text-[11px] leading-relaxed text-ink-3">
        <IconLock size={13} className="mt-px shrink-0" />
        VEV er en egen digital plattform som organisasjoner bruker til å drive fellesskapet sitt.
        VEV styrer ikke det formelle medlemskapet ditt i {preview.communityName}.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-2xl items-center px-5 py-4 lg:px-8">
          <Link href="/">
            <Wordmark />
          </Link>
        </div>
      </header>
      <div className="mx-auto w-full max-w-2xl flex-1 px-5 py-16 lg:px-8">{children}</div>
    </main>
  );
}
