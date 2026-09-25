import Link from "next/link";
import { startOrganizationPersonConversationAction } from "@/app/actions";
import { Avatar, Panel, buttonClass, cn } from "@/components/ui/primitives";
import { IconMail, IconMapPin, IconSend } from "@/components/ui/icons";
import { initialsFor } from "@/lib/format";
import type { CommunityPerson } from "@/lib/types";

function PersonEmail({ email, compact = false }: { email?: string; compact?: boolean }) {
  if (!email) return null;
  return (
    <a
      href={`mailto:${email}`}
      className={cn(
        buttonClass({ variant: "secondary", size: "sm" }),
        compact && "px-2.5",
      )}
    >
      <IconMail size={14} />
      E-post
    </a>
  );
}

export function OrganizationPersonCard({
  person,
  localGroupName,
  compact = false,
  dmAction,
  linkedTitle,
  bio,
  location,
}: {
  person: CommunityPerson;
  localGroupName?: string;
  compact?: boolean;
  dmAction?: { communityId: string; conversationId?: string };
  /**
   * Public membership title from an explicitly linked TING account, shown
   * only when the caller has already decided it says something the Crew role
   * doesn't — this component never compares the two itself.
   */
  linkedTitle?: string;
  /** Bio from an explicitly linked TING account. */
  bio?: string;
  /** Location from an explicitly linked TING account. */
  location?: string;
}) {
  return (
    <Panel as="li" className="flex gap-3.5 p-4">
      <Avatar user={{ id: person.id, name: person.name, initials: initialsFor(person.name) }} size="md" />
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] font-medium text-ink">{person.name}</p>
        {person.role ? <p className="mt-0.5 text-[13px] text-ink-2">{person.role}</p> : null}
        {linkedTitle ? <p className="mt-0.5 text-[13px] text-ink-2">{linkedTitle}</p> : null}
        {localGroupName ? (
          <p className={compact ? "mt-1 text-[13px] font-medium text-ink" : "mt-2 text-[13px] font-medium text-ink"}>
            {localGroupName}
          </p>
        ) : null}
        {person.description ? (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-3">
            {person.description}
          </p>
        ) : null}
        {bio ? (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-3">{bio}</p>
        ) : null}
        {location ? (
          <p className="mt-2.5 flex items-center gap-1 text-[11px] text-ink-3">
            <IconMapPin size={12} />
            {location}
          </p>
        ) : null}
        {dmAction || person.email ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {dmAction ? (
              dmAction.conversationId ? (
                <Link
                  href={`/community/${dmAction.communityId}/messages/${dmAction.conversationId}`}
                  className={buttonClass({ variant: "primary", size: "sm" })}
                >
                  <IconSend size={14} />
                  Send melding
                </Link>
              ) : (
                <form action={startOrganizationPersonConversationAction}>
                  <input type="hidden" name="communityId" value={dmAction.communityId} />
                  <input type="hidden" name="personId" value={person.id} />
                  <button type="submit" className={buttonClass({ variant: "primary", size: "sm" })}>
                    <IconSend size={14} />
                    Send melding
                  </button>
                </form>
              )
            ) : null}
            <PersonEmail email={person.email} compact={compact} />
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
