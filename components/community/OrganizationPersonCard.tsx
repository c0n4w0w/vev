import { Avatar, Panel } from "@/components/ui/primitives";
import type { CommunityPerson } from "@/lib/types";

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function PersonEmail({ email }: { email?: string }) {
  if (!email) return null;
  return (
    <a href={`mailto:${email}`} className="mt-2 inline-flex text-[13px] text-fjord hover:text-ink">
      {email}
    </a>
  );
}

export function OrganizationPersonCard({
  person,
  localGroupName,
  compact = false,
}: {
  person: CommunityPerson;
  localGroupName?: string;
  compact?: boolean;
}) {
  return (
    <Panel as="li" className="flex gap-3.5 p-4">
      <Avatar user={{ id: person.id, name: person.name, initials: initialsFor(person.name) }} size="md" />
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] font-medium text-ink">{person.name}</p>
        {person.role ? <p className="mt-0.5 text-[13px] text-ink-2">{person.role}</p> : null}
        {localGroupName ? (
          <p className={compact ? "mt-1 text-[13px] font-medium text-ink" : "mt-2 text-[13px] font-medium text-ink"}>
            {localGroupName}
          </p>
        ) : null}
        <PersonEmail email={person.email} />
      </div>
    </Panel>
  );
}
