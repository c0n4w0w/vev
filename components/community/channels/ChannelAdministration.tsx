"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { moveChannelSectionAction, moveCommunityChannelAction } from "@/app/channel-actions";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { Badge, EmptyState, Panel, cn } from "@/components/ui/primitives";
import {
  IconChevronDown,
  IconHash,
  IconLock,
  IconMore,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@/components/ui/icons";
import { emptyChannelManageFormState } from "@/lib/channel-management-form";
import { tn } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/react";
import type { Channel, ChannelSection } from "@/lib/types";
import { ChannelCreateDialog } from "./ChannelCreateDialog";
import { ChannelArchiveDialog, ChannelDeleteDialog, ChannelEditDialog, ChannelMoveDialog } from "./ChannelDialogs";
import { SectionCreateDialog, SectionDeleteDialog, SectionRenameDialog } from "./SectionDialogs";
import { quietButtonClass } from "./dialog-parts";

type Counts = { messages: number; attachments: number };

type Dialog =
  | { kind: "createChannel"; sectionId?: string }
  | { kind: "createSection" }
  | { kind: "renameSection" | "deleteSection"; section: ChannelSection }
  | { kind: "edit" | "move" | "archive" | "delete"; channel: Channel };

/**
 * The Kanaler page: every channel and section of one community, for its
 * administrators, in the order members see them. Ordering is by "flytt
 * opp / ned" buttons rather than dragging, so it works the same by keyboard,
 * screen reader and touch. Everything else is in each row's menu, through the
 * same dialogs a channel's own "Administrer kanal" uses.
 *
 * Presentation only. The page found the viewer is an active admin, and every
 * button is decided again by a database function that checks the same thing.
 */
export function ChannelAdministration({
  communityId,
  communityName,
  accent,
  sections,
  channels,
  counts,
  createRequested,
}: {
  communityId: string;
  communityName: string;
  accent: string;
  sections: ChannelSection[];
  /** The community's own channels, archived ones included. */
  channels: Channel[];
  counts: Record<string, Counts | undefined>;
  /** `?ny=kanal`: open the create form straight away. */
  createRequested: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [dialog, setDialog] = useState<Dialog | null>(createRequested ? { kind: "createChannel" } : null);
  const [channelMove, channelMoveAction] = useActionState(moveCommunityChannelAction, emptyChannelManageFormState);
  const [sectionMove, sectionMoveAction] = useActionState(moveChannelSectionAction, emptyChannelManageFormState);

  function close() {
    // Drop `?ny=kanal` so a reload does not reopen the form.
    if (dialog?.kind === "createChannel" && createRequested) router.replace(pathname, { scroll: false });
    setDialog(null);
  }

  const sectionIds = new Set(sections.map((section) => section.id));
  const active = channels.filter((channel) => !channel.archived);
  const archived = channels.filter((channel) => channel.archived);
  const inList = (sectionId: string | null) =>
    active
      .filter((channel) =>
        sectionId === null ? !channel.sectionId || !sectionIds.has(channel.sectionId) : channel.sectionId === sectionId,
      )
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const unsectioned = inList(null);
  // The list a channel is drawn in; reordering keeps it there.
  const listSection = (channel: Channel) =>
    channel.sectionId && sectionIds.has(channel.sectionId) ? channel.sectionId : "";
  const moveError = [channelMove, sectionMove].find((state) => state.status === "error");

  const hidden = <input type="hidden" name="communityId" value={communityId} />;

  function channelMenu(channel: Channel): ActionMenuItem[] {
    return [
      {
        key: "edit",
        label: t("channels.manage.edit"),
        icon: <IconPencil size={15} />,
        onSelect: () => setDialog({ kind: "edit", channel }),
      },
      ...(sections.length > 0 && !channel.archived
        ? [
            {
              key: "move",
              label: t("channels.manage.move"),
              icon: <IconHash size={15} />,
              onSelect: () => setDialog({ kind: "move", channel }),
            },
          ]
        : []),
      {
        key: "archive",
        label: channel.archived ? t("channels.manage.restore") : t("channels.manage.archive"),
        icon: <IconLock size={15} />,
        separatorBefore: true,
        onSelect: () => setDialog({ kind: "archive", channel }),
      },
      {
        key: "delete",
        label: t("channels.manage.delete"),
        icon: <IconTrash size={15} />,
        danger: true,
        onSelect: () => setDialog({ kind: "delete", channel }),
      },
    ];
  }

  function channelRow(channel: Channel, index: number, list: Channel[]) {
    const count = counts[channel.id];
    return (
      <li key={channel.id} className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/community/${communityId}/channel/${channel.id}`}
            className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink hover:underline hover:underline-offset-4"
          >
            <IconHash size={14} className="shrink-0 text-ink-3" />
            <span className="truncate">{channel.name}</span>
          </Link>
          <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
            {channel.readOnly ? (
              <Badge tone="neutral">
                <IconLock size={10} />
                {t("channel.announcementsOnly")}
              </Badge>
            ) : null}
            {count ? <span>{tn(locale, "count.messages", count.messages)}</span> : null}
            {channel.purpose ? <span className="min-w-0 truncate">{channel.purpose}</span> : null}
          </p>
        </div>
        {!channel.archived ? (
          <div className="flex shrink-0 items-center">
            <MoveButton
              action={channelMoveAction}
              disabled={index === 0}
              direction="up"
              label={t("channels.admin.moveUp", { name: channel.name })}
            >
              {hidden}
              <input type="hidden" name="channelId" value={channel.id} />
              <input type="hidden" name="sectionId" value={listSection(channel)} />
              <input type="hidden" name="position" value={Math.max(index - 1, 0)} />
            </MoveButton>
            <MoveButton
              action={channelMoveAction}
              disabled={index === list.length - 1}
              direction="down"
              label={t("channels.admin.moveDown", { name: channel.name })}
            >
              {hidden}
              <input type="hidden" name="channelId" value={channel.id} />
              <input type="hidden" name="sectionId" value={listSection(channel)} />
              <input type="hidden" name="position" value={index + 1} />
            </MoveButton>
          </div>
        ) : null}
        <RowMenu label={t("channels.admin.channelMenu", { name: channel.name })} items={channelMenu(channel)} />
      </li>
    );
  }

  function channelList(list: Channel[], sectionId?: string) {
    if (list.length === 0) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-4">
          <p className="text-[13px] text-ink-3">{t("channels.admin.sectionEmpty")}</p>
          <button
            type="button"
            onClick={() => setDialog({ kind: "createChannel", sectionId })}
            className={cn(quietButtonClass, "inline-flex items-center gap-1.5")}
          >
            <IconPlus size={13} />
            {t("channels.nav.addToSection")}
          </button>
        </div>
      );
    }
    return (
      <ul className="divide-y divide-line">
        {list.map((channel, index) => channelRow(channel, index, list))}
      </ul>
    );
  }

  const nothing = channels.length === 0 && sections.length === 0;

  return (
    <>
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setDialog({ kind: "createChannel" })}
          className="inline-flex h-9 items-center gap-1.5 rounded-[5px] px-3.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: accent }}
        >
          <IconPlus size={15} />
          {t("channels.admin.newChannel")}
        </button>
        <button
          type="button"
          onClick={() => setDialog({ kind: "createSection" })}
          className="inline-flex h-9 items-center gap-1.5 rounded-[5px] border border-line-2 px-3.5 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
        >
          <IconPlus size={15} />
          {t("channels.admin.newSection")}
        </button>
      </div>

      {moveError?.status === "error" ? (
        <p role="alert" className="mb-4 text-[13px] text-rust">
          {moveError.error}
        </p>
      ) : null}

      {nothing ? (
        <EmptyState title={t("channels.admin.emptyTitle")} body={t("channels.admin.emptyBody")} />
      ) : (
        <div className="space-y-6">
          {unsectioned.length > 0 || sections.length === 0 ? (
            <section aria-labelledby="channels-unsectioned">
              <h2 id="channels-unsectioned" className={cn("label mb-2", sections.length === 0 && "sr-only")}>
                {t("channels.admin.unsectioned")}
              </h2>
              <Panel>
                {channelList(unsectioned)}
              </Panel>
            </section>
          ) : null}

          {sections.map((section, sectionIndex) => {
            const list = inList(section.id);
            return (
              <section key={section.id} aria-labelledby={`section-${section.id}`}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 id={`section-${section.id}`} className="label min-w-0 flex-1 truncate">
                    {section.name}
                  </h2>
                  <MoveButton
                    action={sectionMoveAction}
                    disabled={sectionIndex === 0}
                    direction="up"
                    label={`${t("sections.manage.moveUp")}: ${section.name}`}
                  >
                    {hidden}
                    <input type="hidden" name="sectionId" value={section.id} />
                    <input type="hidden" name="position" value={Math.max(sectionIndex - 1, 0)} />
                  </MoveButton>
                  <MoveButton
                    action={sectionMoveAction}
                    disabled={sectionIndex === sections.length - 1}
                    direction="down"
                    label={`${t("sections.manage.moveDown")}: ${section.name}`}
                  >
                    {hidden}
                    <input type="hidden" name="sectionId" value={section.id} />
                    <input type="hidden" name="position" value={sectionIndex + 1} />
                  </MoveButton>
                  <RowMenu
                    label={t("channels.admin.sectionMenu", { name: section.name })}
                    items={[
                      {
                        key: "add",
                        label: t("channels.nav.addToSection"),
                        icon: <IconPlus size={15} />,
                        onSelect: () => setDialog({ kind: "createChannel", sectionId: section.id }),
                      },
                      {
                        key: "rename",
                        label: t("sections.manage.rename"),
                        icon: <IconPencil size={15} />,
                        onSelect: () => setDialog({ kind: "renameSection", section }),
                      },
                      {
                        key: "delete",
                        label: t("sections.manage.delete"),
                        icon: <IconTrash size={15} />,
                        danger: true,
                        separatorBefore: true,
                        onSelect: () => setDialog({ kind: "deleteSection", section }),
                      },
                    ]}
                  />
                </div>
                <Panel>
                  {channelList(list, section.id)}
                </Panel>
              </section>
            );
          })}

          {archived.length > 0 ? (
            <section aria-labelledby="channels-archived">
              <h2 id="channels-archived" className="label mb-1">
                {t("channels.admin.archivedHeading")}
              </h2>
              <p className="mb-2 text-[12px] text-ink-3">{t("channels.admin.archivedLead")}</p>
              <Panel>
                <ul className="divide-y divide-line">
                  {archived.map((channel, index) => channelRow(channel, index, archived))}
                </ul>
              </Panel>
            </section>
          ) : null}
        </div>
      )}

      <p className="mt-8 text-[12px] leading-relaxed text-ink-3">{t("channels.admin.otherChannels")}</p>

      <ChannelCreateDialog
        communityId={communityId}
        communityName={communityName}
        sections={sections}
        defaultSectionId={dialog?.kind === "createChannel" ? dialog.sectionId : undefined}
        accent={accent}
        open={dialog?.kind === "createChannel"}
        onClose={close}
      />
      <SectionCreateDialog communityId={communityId} accent={accent} open={dialog?.kind === "createSection"} onClose={close} />
      {dialog?.kind === "renameSection" || dialog?.kind === "deleteSection" ? (
        <>
          <SectionRenameDialog
            communityId={communityId}
            section={dialog.section}
            accent={accent}
            open={dialog.kind === "renameSection"}
            onClose={close}
          />
          <SectionDeleteDialog
            communityId={communityId}
            section={dialog.section}
            accent={accent}
            open={dialog.kind === "deleteSection"}
            onClose={close}
            channelCount={channels.filter((channel) => channel.sectionId === dialog.section.id).length}
            otherSections={sections.filter((other) => other.id !== dialog.section.id)}
          />
        </>
      ) : null}
      {dialog && "channel" in dialog ? (
        <>
          <ChannelEditDialog
            communityId={communityId}
            channel={dialog.channel}
            accent={accent}
            open={dialog.kind === "edit"}
            onClose={close}
          />
          <ChannelMoveDialog
            communityId={communityId}
            channel={dialog.channel}
            sections={sections}
            accent={accent}
            open={dialog.kind === "move"}
            onClose={close}
          />
          <ChannelArchiveDialog
            communityId={communityId}
            channel={dialog.channel}
            accent={accent}
            open={dialog.kind === "archive"}
            onClose={close}
          />
          <ChannelDeleteDialog
            communityId={communityId}
            channel={dialog.channel}
            counts={counts[dialog.channel.id]}
            accent={accent}
            open={dialog.kind === "delete"}
            onClose={close}
            returnTo="manage"
          />
        </>
      ) : null}
    </>
  );
}

function RowMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  return (
    <ActionMenu
      label={label}
      ariaLabel={label}
      align="right"
      trigger={() => <IconMore size={16} />}
      triggerClassName="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
      items={items}
    />
  );
}

/**
 * One step up or down, as a form of its own, so it works without JavaScript
 * having loaded and cannot be pressed twice while its request is out.
 */
function MoveButton({
  action,
  disabled,
  direction,
  label,
  children,
}: {
  action: (formData: FormData) => void;
  disabled: boolean;
  direction: "up" | "down";
  label: string;
  children: React.ReactNode;
}) {
  return (
    <form action={action}>
      {children}
      <MoveSubmit disabled={disabled} direction={direction} label={label} />
    </form>
  );
}

function MoveSubmit({ disabled, direction, label }: { disabled: boolean; direction: "up" | "down"; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-label={label}
      title={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
    >
      <IconChevronDown size={15} className={cn(direction === "up" && "rotate-180")} />
    </button>
  );
}
