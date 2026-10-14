"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { IconChevronDown, IconHash, IconLock, IconPencil, IconSettings, IconTrash } from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/react";
import type { Channel, ChannelSection } from "@/lib/types";
import { ChannelArchiveDialog, ChannelDeleteDialog, ChannelEditDialog, ChannelMoveDialog } from "./ChannelDialogs";

/**
 * "Administrer kanal" on one of the community's own channels, for its
 * administrators: edit its name, description and who may write in it, move
 * it to another section, archive or restore it, delete it permanently, or go
 * to the Kanaler page for the whole list. Same ActionMenu and dialogs as a
 * private channel's menu.
 *
 * Rendered only for someone the page found is an active admin of this
 * community; each action is decided again by the database.
 */
export function CommunityChannelAdmin({
  communityId,
  channel,
  sections,
  counts,
  accent,
}: {
  communityId: string;
  channel: Channel;
  sections: ChannelSection[];
  counts?: { messages: number; attachments: number };
  accent: string;
}) {
  const t = useT();
  const router = useRouter();
  const [dialog, setDialog] = useState<"edit" | "move" | "archive" | "delete" | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setDialog(null);
    triggerRef.current?.focus();
  }

  const items: ActionMenuItem[] = [
    {
      key: "edit",
      label: t("channels.manage.edit"),
      icon: <IconPencil size={15} />,
      onSelect: () => setDialog("edit"),
    },
    // Moving needs somewhere to go: a section, or out of the one it is in.
    ...(sections.length > 0
      ? [
          {
            key: "move",
            label: t("channels.manage.move"),
            icon: <IconHash size={15} />,
            onSelect: () => setDialog("move"),
          },
        ]
      : []),
    {
      key: "archive",
      label: channel.archived ? t("channels.manage.restore") : t("channels.manage.archive"),
      icon: <IconLock size={15} />,
      separatorBefore: true,
      onSelect: () => setDialog("archive"),
    },
    {
      key: "delete",
      label: t("channels.manage.delete"),
      icon: <IconTrash size={15} />,
      danger: true,
      onSelect: () => setDialog("delete"),
    },
    {
      key: "all",
      label: t("channels.manage.all"),
      icon: <IconSettings size={15} />,
      separatorBefore: true,
      onSelect: () => router.push(`/community/${communityId}/kanaler`),
    },
  ];

  return (
    <>
      <ActionMenu
        label={t("channels.manage.menu")}
        triggerRef={triggerRef}
        align="right"
        trigger={(open) => (
          <>
            {t("channels.manage.menu")}
            <IconChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
          </>
        )}
        triggerClassName={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-line-2 px-2.5 text-[13px] text-ink-2",
          "transition-colors hover:border-ink-3 hover:text-ink",
        )}
        items={items}
      />

      <ChannelEditDialog
        communityId={communityId}
        channel={channel}
        accent={accent}
        open={dialog === "edit"}
        onClose={close}
      />
      <ChannelMoveDialog
        communityId={communityId}
        channel={channel}
        sections={sections}
        accent={accent}
        open={dialog === "move"}
        onClose={close}
      />
      <ChannelArchiveDialog
        communityId={communityId}
        channel={channel}
        accent={accent}
        open={dialog === "archive"}
        onClose={close}
      />
      <ChannelDeleteDialog
        communityId={communityId}
        channel={channel}
        counts={counts}
        accent={accent}
        open={dialog === "delete"}
        onClose={close}
      />
    </>
  );
}
