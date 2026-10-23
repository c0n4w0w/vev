import { Wordmark } from "@/components/shell/Wordmark";
import { ButtonLink } from "@/components/ui/primitives";

/**
 * What a member sees in a community TING has suspended: that it is
 * suspended, and nothing of its content. In the platform's language, since
 * it is TING speaking rather than the community.
 */
export function CommunitySuspended({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-xl px-5 py-16 lg:px-10">
      <Wordmark size="app" />
      <p className="label mt-8">Midlertidig utilgjengelig</p>
      <h1 className="mt-3 font-display text-[1.75rem] leading-tight text-ink">{name} er suspendert</h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">
        TING har midlertidig stengt dette fellesskapet. Ingenting er slettet, men ingen kan lese eller skrive i det før det er
        åpnet igjen. Spørsmål kan rettes til fellesskapets administrator eller til{" "}
        <a href="mailto:hei@join-ting.no" className="text-skog underline underline-offset-2">
          hei@join-ting.no
        </a>
        .
      </p>
      <ButtonLink href="/home" variant="secondary" className="mt-8">
        Til forsiden
      </ButtonLink>
    </div>
  );
}
