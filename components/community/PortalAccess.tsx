"use client";

import { useState } from "react";
import { requestAccess } from "@/app/actions";
import { Badge, Panel } from "@/components/ui/primitives";
import { IconLock, IconMail } from "@/components/ui/icons";
import type { CommunityPublic } from "@/lib/types";

/**
 * The access panel on a public portal. This is the only door into a community
 * for someone who is not already a member.
 *
 * Submitting records a membership with status `requested`; the portal then
 * renders the waiting state, and the request appears for the community's
 * admins under Medlemmer.
 */
export function PortalAccess({
  community,
  signedIn,
}: {
  community: CommunityPublic;
  signedIn: boolean;
}) {
  const [reason, setReason] = useState("");

  if (community.accessPolicy === "invite-only") {
    return (
      <Panel className="p-5">
        <Badge tone="neutral">
          <IconLock size={11} />
          Kun ved invitasjon
        </Badge>
        <h2 className="mt-3 font-display text-lg text-ink">Dette rommet er lukket</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {community.name} tar ikke imot åpne søknader. Nye medlemmer blir invitert av noen som
          allerede er her. Kjenner du noen i kollektivet, er det dem du skal snakke med.
        </p>
        <a
          href={`mailto:hei@${community.slug}.no`}
          className="mt-4 inline-flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-70"
          style={{ color: community.branding.accent }}
        >
          <IconMail size={15} />
          Ta kontakt på e-post
        </a>
      </Panel>
    );
  }

  return (
    <Panel className="p-5">
      <h2 className="font-display text-lg text-ink">Be om tilgang</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        {signedIn
          ? `Fortell kort hvem du er, så tar en administrator i ${community.name} stilling til forespørselen.`
          : `Du må være innlogget på Vev for å sende en forespørsel. Kontoen din er den samme uansett hvor mange fellesskap du er med i.`}
      </p>

      <form action={requestAccess} className="mt-4">
        <input type="hidden" name="communityId" value={community.id} />
        <input type="hidden" name="slug" value={community.slug} />
        <label htmlFor="reason" className="label">
          Om deg
        </label>
        <textarea
          id="reason"
          name="reason"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={!signedIn}
          placeholder="For eksempel: hvordan du kjenner organisasjonen, og hva du vil bidra med."
          className="mt-2 w-full resize-none rounded-[5px] border border-line-2 bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink-3 disabled:bg-paper-2/60 disabled:text-ink-3"
        />
        <button
          type="submit"
          disabled={!signedIn || !reason.trim()}
          className="mt-3 h-10 w-full rounded-[5px] text-sm font-medium text-white transition-opacity disabled:opacity-30"
          style={{ backgroundColor: community.branding.accent }}
        >
          Send forespørsel
        </button>
      </form>
    </Panel>
  );
}
