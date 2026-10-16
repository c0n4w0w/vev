"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui/primitives";
import {
  IconArrowRight,
  IconAudio,
  IconChevronRight,
  IconClose,
  IconDownload,
  IconExternal,
  IconFile,
  IconFolder,
  IconLink,
  IconMore,
  IconPin,
  IconPlus,
  IconSearch,
} from "@/components/ui/icons";
import {
  addChannelLinkAction,
  createResourceFolderAction,
  deleteChannelLinkAction,
  deleteResourceFolderAction,
  moveChannelResourceAction,
  renameResourceFolderAction,
  setChannelFileSharingAction,
  setChannelResourcePinnedAction,
  updateChannelLinkAction,
  type ResourceActionResult,
} from "@/app/resource-actions";
import { formatFileSize } from "@/lib/collaboration-file-type";
import { formatFullDate } from "@/lib/format";
import { tn } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/react";
import { attachmentTypeLabel } from "@/lib/attachment-types";
import {
  LINK_DESCRIPTION_MAX,
  LINK_TITLE_MAX,
  LINK_URL_MAX,
  RESOURCE_FOLDER_MAX_DEPTH,
  RESOURCE_FOLDER_NAME_MAX,
  RESOURCE_KINDS,
  RESOURCE_SEARCH_MAX,
  RESOURCE_SORTS,
  normalizeLinkUrl,
  resourceQueryString,
  type ChannelResource,
  type FileResource,
  type LinkResource,
  type ResourceFolder,
  type ResourceKind,
  type ResourceLocation,
  type ResourcePage,
  type ResourceQuery,
  type ResourceSort,
  type ResourceSummary,
} from "@/lib/channel-resources";

// The same viewer a message opens, fetched only when a file is previewed.
const AttachmentViewer = dynamic(
  () => import("@/components/community/attachments/AttachmentViewer").then((mod) => mod.AttachmentViewer),
  { ssr: false },
);

const fieldClass =
  "h-9 w-full min-w-0 rounded-[5px] border border-line-2 bg-surface px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-3";
const quietButton =
  "inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-line-2 bg-surface px-2.5 text-[13px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-40";
const iconButton = "shrink-0 rounded-[5px] p-2 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink";

export interface ResourcePermissions {
  /** Add links, create folders, file resources (channel_resource_rights → contribute). */
  canContribute: boolean;
  /** A community administrator in a channel that is not archived: pins, every link and folder. */
  canManage: boolean;
  viewerId: string;
}

/**
 * "Ressurser" in a channel's header, and the library it opens: the files sent
 * in the channel, links its members added, optional folders and pins.
 *
 * Presentation only. Every list comes from the channel's resources route,
 * read with the viewer's session; every change is a server action whose
 * database function asks the channel's rules again. The flags in
 * `permissions` only decide which controls are offered. Files keep their
 * previews, downloads and "Gå til melding"; links open in a new tab and are
 * never fetched.
 */
export function ChannelResourceLibrary({
  communityId,
  channelId,
  channelName,
  summary,
  permissions,
  uploads,
  accent,
  onGoToMessage,
}: {
  communityId: string;
  channelId: string;
  channelName: string;
  /** As the page was rendered; the dialog reads fresh counts when it opens. */
  summary: ResourceSummary;
  permissions: ResourcePermissions;
  /** A lokallag's main chat, for someone who may switch its uploads. */
  uploads?: { enabled: boolean };
  accent: string;
  onGoToMessage: (messageId: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={t("resources.openLabel")}
        className={quietButton}
      >
        <IconFolder size={14} />
        {t("resources.open")}
      </button>
      {open ? (
        <LibraryDialog
          communityId={communityId}
          channelId={channelId}
          channelName={channelName}
          initialSummary={summary}
          permissions={permissions}
          uploads={uploads}
          accent={accent}
          onClose={() => setOpen(false)}
          onGoToMessage={(messageId) => {
            setOpen(false);
            onGoToMessage(messageId);
          }}
        />
      ) : null}
    </>
  );
}

type Panel =
  | { type: "link"; link?: LinkResource }
  | { type: "folder"; parent?: ResourceFolder; folder?: ResourceFolder }
  | { type: "move"; resource: ChannelResource }
  | { type: "deleteFolder"; folder: ResourceFolder }
  | { type: "removeLink"; link: LinkResource };

const DEFAULT_QUERY = { search: "", kind: "all" as ResourceKind, contributorId: undefined as string | undefined, sort: "newest" as ResourceSort };

function LibraryDialog({
  communityId,
  channelId,
  channelName,
  initialSummary,
  permissions,
  uploads,
  accent,
  onClose,
  onGoToMessage,
}: {
  communityId: string;
  channelId: string;
  channelName: string;
  initialSummary: ResourceSummary;
  permissions: ResourcePermissions;
  uploads?: { enabled: boolean };
  accent: string;
  onClose: () => void;
  onGoToMessage: (messageId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const searchId = useId();
  const kindId = useId();
  const contributorId = useId();
  const sortId = useId();
  const viewId = useId();

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(DEFAULT_QUERY);
  const [location, setLocation] = useState<ResourceLocation>("all");
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState<ResourcePage | null>(null);
  const [resources, setResources] = useState<ChannelResource[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loaded, setLoaded] = useState<{ key: string; status: "ready" | "error" } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | undefined>();
  const [preview, setPreview] = useState<{ items: FileResource[]; index: number } | null>(null);
  const [playing, setPlaying] = useState<string | undefined>();
  const requestRef = useRef<AbortController | null>(null);

  const meta = page?.meta;
  const summary = meta?.summary ?? initialSummary;
  const folders = useMemo(() => meta?.folders ?? [], [meta]);
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const searching = filters.search !== "";
  const filtered = searching || filters.kind !== "all" || Boolean(filters.contributorId);
  // A search looks in every folder; otherwise the list shows where one is.
  const currentFolder = location !== "all" && location !== "none" ? folderById.get(location) : undefined;
  const effectiveLocation: ResourceLocation = searching ? "all" : location;
  const query: ResourceQuery = { ...filters, location: effectiveLocation };

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      requestRef.current?.abort();
    };
  }, []);

  // Typing settles for a moment before it becomes a search.
  useEffect(() => {
    const value = search.trim();
    if (value === filters.search) return;
    const timer = setTimeout(() => setFilters((current) => ({ ...current, search: value })), 250);
    return () => clearTimeout(timer);
  }, [search, filters.search]);

  const fetchPage = useCallback(
    async (target: ResourceQuery, withMeta: boolean): Promise<ResourcePage> => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      const response = await fetch(
        `/community/${encodeURIComponent(communityId)}/channel/${encodeURIComponent(channelId)}/resources?${resourceQueryString(
          target,
          withMeta ? { meta: "1" } : {},
        )}`,
        { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } },
      );
      if (!response.ok) throw new Error(String(response.status));
      return (await response.json()) as ResourcePage;
    },
    [communityId, channelId],
  );

  const queryKey = `${resourceQueryString(query)}#${refresh}`;
  const status = loaded?.key === queryKey ? loaded.status : "loading";

  useEffect(() => {
    let current = true;
    fetchPage({ ...query, cursor: undefined }, true)
      .then((result) => {
        if (!current) return;
        setPage(result);
        setResources(result.resources);
        setNextCursor(result.nextCursor);
        setLoaded({ key: queryKey, status: "ready" });
        // A folder someone else just deleted: back to the top.
        if (location !== "all" && location !== "none" && !result.meta?.folders.some((folder) => folder.id === location)) {
          setLocation("all");
        }
      })
      .catch((error: unknown) => {
        if (!current || (error instanceof DOMException && error.name === "AbortError")) return;
        setLoaded({ key: queryKey, status: "error" });
      });
    return () => {
      current = false;
    };
    // queryKey stands for the query, the location and the refresh count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, fetchPage]);

  async function loadMore() {
    if (!nextCursor || loadingMore || status === "loading") return;
    setLoadingMore(true);
    try {
      const more = await fetchPage({ ...query, cursor: nextCursor }, false);
      setResources((current) => {
        const seen = new Set(current.map((resource) => resource.id));
        return [...current, ...more.resources.filter((resource) => !seen.has(resource.id))];
      });
      setNextCursor(more.nextCursor);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setLoaded({ key: queryKey, status: "error" });
    } finally {
      setLoadingMore(false);
    }
  }

  /** After a change: read everything again, and let the page update its counts. */
  function changed(result: ResourceActionResult): boolean {
    if (!result.ok) {
      setNotice(result.error);
      return false;
    }
    setNotice(undefined);
    setPanel(null);
    setExpanded(null);
    setRefresh((n) => n + 1);
    router.refresh();
    return true;
  }

  const scope = { communityId, channelId };

  // ── Folder tree ──────────────────────────────────────────────────────
  const childrenOf = useMemo(() => {
    const map = new Map<string, ResourceFolder[]>();
    for (const folder of folders) {
      const key = folder.parentId ?? "";
      map.set(key, [...(map.get(key) ?? []), folder]);
    }
    return map;
  }, [folders]);

  const totalIn = useMemo(() => {
    const totals = new Map<string, number>();
    const count = (folder: ResourceFolder): number => {
      const cached = totals.get(folder.id);
      if (cached !== undefined) return cached;
      const total = folder.resourceCount + (childrenOf.get(folder.id) ?? []).reduce((sum, child) => sum + count(child), 0);
      totals.set(folder.id, total);
      return total;
    };
    for (const folder of folders) count(folder);
    return totals;
  }, [folders, childrenOf]);

  const pathOf = useCallback(
    (folderId: string | undefined): ResourceFolder[] => {
      const path: ResourceFolder[] = [];
      let folder = folderId ? folderById.get(folderId) : undefined;
      while (folder && path.length < RESOURCE_FOLDER_MAX_DEPTH + 1) {
        path.unshift(folder);
        folder = folder.parentId ? folderById.get(folder.parentId) : undefined;
      }
      return path;
    },
    [folderById],
  );

  const visibleFolders = searching ? [] : location === "all" || location === "none" ? (childrenOf.get("") ?? []) : (childrenOf.get(location) ?? []);
  const files = resources.filter((resource): resource is FileResource => resource.type === "file");
  const pins = meta?.pins ?? [];
  const total = summary.files + summary.links;
  const nothingAtAll = total === 0 && folders.length === 0 && !filtered;

  function openPreview(resource: FileResource) {
    if (resource.attachment.kind === "audio") {
      setPlaying((current) => (current === resource.id ? undefined : resource.id));
      return;
    }
    if (resource.attachment.kind === "image") {
      const images = [...pins, ...files].filter(
        (item, index, all): item is FileResource =>
          item.type === "file" && item.attachment.kind === "image" && all.findIndex((other) => other.id === item.id) === index,
      );
      setPreview({ items: images, index: Math.max(0, images.findIndex((image) => image.id === resource.id)) });
      return;
    }
    setPreview({ items: [resource], index: 0 });
  }

  const ownsOrManages = (ownerId: string | undefined) =>
    permissions.canManage || (permissions.canContribute && Boolean(ownerId) && ownerId === permissions.viewerId);

  function rowActions(resource: ChannelResource): { key: string; label: string; onSelect: () => void; danger?: boolean }[] {
    const items: { key: string; label: string; onSelect: () => void; danger?: boolean }[] = [];
    if (permissions.canContribute && (folders.length > 0 || resource.folderId)) {
      items.push({ key: "move", label: t("resources.action.move"), onSelect: () => setPanel({ type: "move", resource }) });
    }
    if (permissions.canManage) {
      items.push({
        key: "pin",
        label: t(resource.pinned ? "resources.action.unpin" : "resources.action.pin"),
        onSelect: async () =>
          changed(await setChannelResourcePinnedAction(scope, { type: resource.type, id: resource.id, pinned: !resource.pinned })),
      });
    }
    if (resource.type === "link" && ownsOrManages(resource.contributorId)) {
      items.push({ key: "edit", label: t("resources.action.edit"), onSelect: () => setPanel({ type: "link", link: resource }) });
      items.push({
        key: "remove",
        label: t("resources.action.remove"),
        danger: true,
        onSelect: () => setPanel({ type: "removeLink", link: resource }),
      });
    }
    return items;
  }

  function renderRow(resource: ChannelResource, keyPrefix = "") {
    const key = `${keyPrefix}${resource.id}`;
    const actions = rowActions(resource);
    const folderLabel =
      (location === "all" || searching) && resource.folderId
        ? pathOf(resource.folderId).map((folder) => folder.name).join(" / ")
        : undefined;
    return (
      <ResourceRow
        key={key}
        resource={resource}
        folderLabel={folderLabel}
        playing={playing === resource.id}
        expanded={expanded === key}
        actions={actions}
        onToggle={() => setExpanded((current) => (current === key ? null : key))}
        onPreview={() => resource.type === "file" && openPreview(resource)}
        onGoToMessage={() => resource.type === "file" && onGoToMessage(resource.messageId)}
      />
    );
  }

  // Closing tells the owner directly as well as through the dialog's close
  // event, which a browser may hold back while the page is in the background.
  function close() {
    ref.current?.close();
    onClose();
  }

  const canCreateFolderHere = permissions.canContribute && !searching && (!currentFolder || currentFolder.depth < RESOURCE_FOLDER_MAX_DEPTH);

  return (
    <>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClose={onClose}
        onCancel={(event) => {
          // Escape closes an open form first, then the library.
          if (panel) {
            event.preventDefault();
            setPanel(null);
          }
        }}
        onClick={(event) => {
          if (event.target === ref.current) close();
        }}
        className={cn(
          "m-auto h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-surface p-0 text-left text-ink shadow-xl",
          "backdrop:bg-ink/45",
          "sm:h-[min(48rem,calc(100dvh-3rem))] sm:w-[min(46rem,calc(100vw-3rem))] sm:rounded-[8px] sm:border sm:border-line",
        )}
      >
        <div className="flex h-full min-h-0 flex-col">
          <header className="flex shrink-0 items-start gap-2 border-b border-line px-4 pb-3 pt-3.5 sm:px-5">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate font-display text-lg leading-snug text-ink">
                {t("resources.title", { name: channelName })}
              </h2>
              <p className="text-[12px] text-ink-3">
                {[
                  tn(locale, "count.files", summary.files),
                  tn(locale, "count.links", summary.links),
                  ...(summary.folders ? [tn(locale, "count.folders", summary.folders)] : []),
                ].join(" · ")}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={t("common.close")}
              title={t("common.close")}
              className={cn(iconButton, "-mr-1.5")}
            >
              <IconClose size={18} />
            </button>
          </header>

          {panel ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
              <PanelForm
                panel={panel}
                scope={scope}
                folders={folders}
                pathOf={pathOf}
                childrenOf={childrenOf}
                currentFolder={currentFolder}
                accent={accent}
                onCancel={() => {
                  setPanel(null);
                  setNotice(undefined);
                }}
                onDone={changed}
              />
            </div>
          ) : (
            <>
              {!nothingAtAll || permissions.canContribute || uploads ? (
                <div className="shrink-0 space-y-2.5 border-b border-line bg-paper px-4 py-3 sm:px-5">
                  {!nothingAtAll ? (
                    <>
                      <div className="relative">
                        <label htmlFor={searchId} className="sr-only">
                          {t("resources.searchLabel")}
                        </label>
                        <IconSearch
                          size={15}
                          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
                        />
                        <input
                          id={searchId}
                          type="search"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          maxLength={RESOURCE_SEARCH_MAX}
                          placeholder={t("resources.search")}
                          autoComplete="off"
                          className="h-9 w-full rounded-[5px] border border-line-2 bg-surface pl-8 pr-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
                        />
                      </div>
                      <div role="radiogroup" aria-labelledby={kindId} className="flex flex-wrap gap-1.5">
                        <span id={kindId} className="sr-only">
                          {t("resources.kindLabel")}
                        </span>
                        {RESOURCE_KINDS.map((kind) => {
                          const selected = filters.kind === kind;
                          return (
                            <button
                              key={kind}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => setFilters((current) => ({ ...current, kind }))}
                              className={cn(
                                "h-7 rounded-full border px-3 text-[12px] transition-colors",
                                selected
                                  ? "border-ink bg-ink text-white"
                                  : "border-line-2 bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                              )}
                            >
                              {t(`resources.kind.${kind}`)}
                            </button>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="min-w-0">
                          <label htmlFor={contributorId} className="label mb-1 block">
                            {t("resources.contributorLabel")}
                          </label>
                          <select
                            id={contributorId}
                            value={filters.contributorId ?? ""}
                            onChange={(event) =>
                              setFilters((current) => ({ ...current, contributorId: event.target.value || undefined }))
                            }
                            className={fieldClass}
                          >
                            <option value="">{t("resources.contributor.all")}</option>
                            {(meta?.contributors ?? []).map((contributor) => (
                              <option key={contributor.id} value={contributor.id}>
                                {`${contributor.name || t("common.unknown")} (${contributor.count})`}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="min-w-0">
                          <label htmlFor={sortId} className="label mb-1 block">
                            {t("resources.sortLabel")}
                          </label>
                          <select
                            id={sortId}
                            value={filters.sort}
                            onChange={(event) =>
                              setFilters((current) => ({ ...current, sort: event.target.value as ResourceSort }))
                            }
                            className={fieldClass}
                          >
                            {RESOURCE_SORTS.map((sort) => (
                              <option key={sort} value={sort}>
                                {t(`resources.sort.${sort}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </>
                  ) : null}
                  {uploads ? (
                    <UploadsSwitch
                      enabled={uploads.enabled}
                      onChange={async (enabled) => changed(await setChannelFileSharingAction(scope, enabled))}
                    />
                  ) : null}
                  {permissions.canContribute ? (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setPanel({ type: "link" })} className={quietButton}>
                        <IconLink size={14} />
                        {t("resources.addLink")}
                      </button>
                      {canCreateFolderHere ? (
                        <button
                          type="button"
                          onClick={() => setPanel({ type: "folder", parent: currentFolder })}
                          className={quietButton}
                        >
                          <IconPlus size={14} />
                          {t(currentFolder ? "resources.newSubfolder" : "resources.newFolder")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-busy={status === "loading"}>
                {notice ? (
                  <p role="alert" className="mx-4 mt-3 rounded-[5px] border border-rust/30 bg-rust-soft px-3 py-2 text-[13px] text-rust sm:mx-5">
                    {notice}
                  </p>
                ) : null}

                {status === "error" ? (
                  <div className="px-5 py-10 text-center">
                    <p role="alert" className="text-[13px] text-rust">
                      {t("resources.loadFailed")}
                    </p>
                    <button type="button" onClick={() => setRefresh((n) => n + 1)} className={cn(quietButton, "mt-3")}>
                      {t("resources.retry")}
                    </button>
                  </div>
                ) : status === "loading" && !page ? (
                  <p role="status" className="px-5 py-10 text-center text-[13px] text-ink-3">
                    {t("resources.loading")}
                  </p>
                ) : nothingAtAll ? (
                  <EmptyState title={t("resources.empty.title")} body={t("resources.empty.body")} />
                ) : (
                  <div className={cn(status === "loading" && "opacity-60")}>
                    {/* Pinned, at the top of the library, wherever they are filed. */}
                    {location === "all" && !filtered && pins.length > 0 ? (
                      <Section title={t("resources.pinned")} icon={<IconPin size={13} />}>
                        <ul aria-label={t("resources.pinned")} className="divide-y divide-line">
                          {pins.map((resource) => renderRow(resource, "pin:"))}
                        </ul>
                      </Section>
                    ) : null}

                    {!searching && currentFolder ? (
                      <nav aria-label={t("resources.breadcrumbLabel")} className="flex flex-wrap items-center gap-1 px-4 pt-3 text-[13px] sm:px-5">
                        <button type="button" onClick={() => setLocation("all")} className="text-ink-3 hover:text-ink hover:underline">
                          {t("resources.breadcrumbRoot")}
                        </button>
                        {pathOf(currentFolder.id).map((folder) => (
                          <span key={folder.id} className="flex min-w-0 items-center gap-1">
                            <IconChevronRight size={12} className="shrink-0 text-ink-3" />
                            {folder.id === currentFolder.id ? (
                              <span aria-current="page" className="max-w-[12rem] truncate font-medium text-ink">
                                {folder.name}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setLocation(folder.id)}
                                className="max-w-[10rem] truncate text-ink-3 hover:text-ink hover:underline"
                              >
                                {folder.name}
                              </button>
                            )}
                          </span>
                        ))}
                      </nav>
                    ) : null}

                    {visibleFolders.length > 0 ? (
                      <Section title={t("resources.folders")} icon={<IconFolder size={13} />}>
                        <ul aria-label={t("resources.folders")} className="divide-y divide-line">
                          {visibleFolders.map((folder) => (
                            <FolderRow
                              key={folder.id}
                              folder={folder}
                              total={totalIn.get(folder.id) ?? 0}
                              expanded={expanded === `folder:${folder.id}`}
                              actions={
                                ownsOrManages(folder.createdBy)
                                  ? [
                                      {
                                        key: "rename",
                                        label: t("resources.action.renameFolder"),
                                        onSelect: () => setPanel({ type: "folder", folder }),
                                      },
                                      {
                                        key: "delete",
                                        label: t("resources.action.deleteFolder"),
                                        danger: true,
                                        onSelect: () => setPanel({ type: "deleteFolder", folder }),
                                      },
                                    ]
                                  : []
                              }
                              onOpen={() => {
                                setExpanded(null);
                                setLocation(folder.id);
                              }}
                              onToggle={() =>
                                setExpanded((current) => (current === `folder:${folder.id}` ? null : `folder:${folder.id}`))
                              }
                            />
                          ))}
                        </ul>
                      </Section>
                    ) : null}

                    {/* What the list shows: everything, or what is in no folder. */}
                    {!searching && !currentFolder && folders.length > 0 ? (
                      <div role="radiogroup" aria-labelledby={viewId} className="flex gap-1.5 px-4 pt-4 sm:px-5">
                        <span id={viewId} className="sr-only">
                          {t("resources.viewLabel")}
                        </span>
                        {(["all", "none"] as const).map((view) => (
                          <button
                            key={view}
                            type="button"
                            role="radio"
                            aria-checked={location === view}
                            onClick={() => setLocation(view)}
                            className={cn(
                              "h-7 rounded-[5px] px-2.5 text-[12px] font-medium transition-colors",
                              location === view ? "bg-paper-2 text-ink" : "text-ink-3 hover:text-ink",
                            )}
                          >
                            {t(`resources.view.${view}`)}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {searching ? (
                      <p className="label px-4 pt-4 sm:px-5">{t("resources.searchResults")}</p>
                    ) : null}

                    {resources.length === 0 && status !== "loading" ? (
                      filtered ? (
                        <EmptyState title={t("resources.noMatches.title")} body={t("resources.noMatches.body")}>
                          <button
                            type="button"
                            onClick={() => {
                              setSearch("");
                              setFilters((current) => ({ ...DEFAULT_QUERY, sort: current.sort }));
                            }}
                            className={cn(quietButton, "mt-3")}
                          >
                            {t("resources.clearFilters")}
                          </button>
                        </EmptyState>
                      ) : currentFolder ? (
                        visibleFolders.length === 0 ? <p className="px-5 py-8 text-center text-[13px] text-ink-3">{t("resources.emptyFolder")}</p> : null
                      ) : location === "none" ? (
                        <p className="px-5 py-8 text-center text-[13px] text-ink-3">{t("resources.emptyUnfiled")}</p>
                      ) : null
                    ) : (
                      <ul aria-label={t("resources.list")} className="mt-1 divide-y divide-line border-t border-line">
                        {resources.map((resource) => renderRow(resource))}
                      </ul>
                    )}

                    {nextCursor ? (
                      <div className="px-5 py-4 text-center">
                        <button
                          type="button"
                          onClick={loadMore}
                          disabled={loadingMore || status === "loading"}
                          className={quietButton}
                        >
                          {loadingMore ? t("resources.loading") : t("resources.loadMore")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </dialog>
      {/* A sibling, not a child: the viewer is its own modal on top of this
          one, and closing it must not reach this dialog's close handler. */}
      {preview ? (
        <AttachmentViewer
          items={preview.items.map((item) => item.attachment)}
          initialIndex={preview.index}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  );
}

/**
 * "Tillat filvedlegg i chatten" for a lokallag's main chat, which has no edit
 * dialog. Shown to whoever the database lets switch it; the change is
 * decided there again (set_channel_file_sharing), and the page refreshes so
 * the paperclip follows.
 */
function UploadsSwitch({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => Promise<boolean> }) {
  const t = useT();
  const id = useId();
  const [checked, setChecked] = useState(enabled);
  const [pending, startTransition] = useTransition();
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-2.5 rounded-[5px] border border-line bg-surface px-3 py-2 has-[:checked]:border-ink-3"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.checked;
          setChecked(next);
          startTransition(async () => {
            if (!(await onChange(next))) setChecked(!next);
          });
        }}
        className="mt-1"
      />
      <span className="min-w-0">
        <span className="block text-sm text-ink">{t("resources.uploads.label")}</span>
        <span className="block text-[12px] leading-snug text-ink-3">{t("resources.uploads.hint")}</span>
      </span>
    </label>
  );
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="pt-3">
      <h3 className="label flex items-center gap-1.5 px-4 pb-1 sm:px-5">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function EmptyState({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="font-display text-base text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-ink-3">{body}</p>
      {children}
    </div>
  );
}

type RowAction = { key: string; label: string; onSelect: () => void; danger?: boolean };

/** A row's extra actions, shown inline under it so nothing is clipped by the scrolling list. */
function ActionBar({ actions }: { actions: RowAction[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 pl-[3.25rem]">
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          onClick={action.onSelect}
          className={cn(quietButton, "h-7 text-[12px]", action.danger && "text-rust hover:border-rust hover:text-rust")}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

function MoreButton({ name, expanded, onToggle }: { name: string; expanded: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={t("resources.more", { name })}
      title={t("resources.more", { name })}
      className={cn(iconButton, expanded && "bg-paper-2 text-ink")}
    >
      <IconMore size={16} />
    </button>
  );
}

function FolderRow({
  folder,
  total,
  expanded,
  actions,
  onOpen,
  onToggle,
}: {
  folder: ResourceFolder;
  total: number;
  expanded: boolean;
  actions: RowAction[];
  onOpen: () => void;
  onToggle: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <li className="px-3 py-2 sm:px-4">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onOpen}
          aria-label={t("resources.openFolder", { name: folder.name })}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-[5px] p-1 text-left transition-colors hover:bg-paper-2/70"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] border border-line bg-paper text-ink-3">
            <IconFolder size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">{folder.name}</span>
            <span className="block truncate text-[11px] text-ink-3">{tn(locale, "count.resources", total)}</span>
          </span>
          <IconChevronRight size={15} className="shrink-0 text-ink-3" />
        </button>
        {actions.length > 0 ? <MoreButton name={folder.name} expanded={expanded} onToggle={onToggle} /> : null}
      </div>
      {expanded && actions.length > 0 ? <ActionBar actions={actions} /> : null}
    </li>
  );
}

function ResourceRow({
  resource,
  folderLabel,
  playing,
  expanded,
  actions,
  onToggle,
  onPreview,
  onGoToMessage,
}: {
  resource: ChannelResource;
  folderLabel?: string;
  playing: boolean;
  expanded: boolean;
  actions: RowAction[];
  onToggle: () => void;
  onPreview: () => void;
  onGoToMessage: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const who = resource.contributorName || t("common.unknown");
  const pin = resource.pinned ? (
    <span className="ml-1.5 inline-flex shrink-0 items-center gap-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-ink-3">
      <IconPin size={10} />
      <span className="sr-only">{t("resources.pinnedBadge")}</span>
    </span>
  ) : null;
  const where = folderLabel ? ` · ${t("resources.inFolder", { name: folderLabel })}` : "";

  if (resource.type === "link") {
    return (
      <li className="px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-1 sm:gap-2">
          <a
            href={resource.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            referrerPolicy="no-referrer"
            aria-label={t("resources.openLinkNamed", { name: resource.name })}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-[5px] p-1 text-left transition-colors hover:bg-paper-2/70"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] border border-line bg-paper text-ink-3">
              <IconLink size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center">
                <span className="truncate text-[13px] font-medium text-ink">{resource.name}</span>
                {pin}
              </span>
              <span className="block truncate text-[11px] text-ink-3">
                {`${resource.hostname} · ${formatFullDate(resource.createdAt, locale)}${where}`}
              </span>
              <span className="block truncate text-[11px] text-ink-3">{t("resources.addedBy", { name: who })}</span>
              {resource.description ? (
                <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-ink-2">{resource.description}</span>
              ) : null}
            </span>
          </a>
          <a
            href={resource.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            referrerPolicy="no-referrer"
            tabIndex={-1}
            aria-hidden="true"
            className={iconButton}
          >
            <IconExternal size={16} />
          </a>
          {actions.length > 0 ? <MoreButton name={resource.name} expanded={expanded} onToggle={onToggle} /> : null}
        </div>
        {expanded && actions.length > 0 ? <ActionBar actions={actions} /> : null}
      </li>
    );
  }

  const file = resource.attachment;
  const meta = `${attachmentTypeLabel(file.mimeType)} · ${formatFileSize(file.sizeBytes, locale)} · ${formatFullDate(resource.createdAt, locale)}${where}`;
  return (
    <li className="px-3 py-2.5 sm:px-4">
      <div className="flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={onPreview}
          aria-label={t("resources.previewNamed", { name: resource.name })}
          title={t("resources.preview")}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-[5px] p-1 text-left transition-colors hover:bg-paper-2/70"
        >
          <FileIcon resource={resource} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center">
              <span className="truncate text-[13px] font-medium text-ink">{resource.name}</span>
              {pin}
            </span>
            <span className="block truncate text-[11px] text-ink-3">{meta}</span>
            <span className="block truncate text-[11px] text-ink-3">{t("resources.sharedBy", { name: who })}</span>
          </span>
        </button>
        <a
          href={`${file.url}?download=1`}
          download={resource.name}
          aria-label={t("attachments.downloadNamed", { name: resource.name })}
          title={t("attachments.download")}
          className={iconButton}
        >
          <IconDownload size={16} />
        </a>
        <button
          type="button"
          onClick={onGoToMessage}
          aria-label={t("resources.goToMessageNamed", { name: resource.name })}
          title={t("resources.goToMessage")}
          className="inline-flex shrink-0 items-center gap-1 rounded-[5px] p-2 text-[12px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink md:border md:border-line-2 md:px-2.5 md:py-1.5"
        >
          <span className="hidden md:inline">{t("resources.goToMessage")}</span>
          <IconArrowRight size={14} />
        </button>
        {actions.length > 0 ? <MoreButton name={resource.name} expanded={expanded} onToggle={onToggle} /> : null}
      </div>
      {playing ? (
        // The browser's own player, as in the conversation. Nothing is fetched until it plays.
        <audio controls autoPlay preload="none" src={file.url} aria-label={resource.name} className="mt-1.5 block h-10 w-full" />
      ) : null}
      {expanded && actions.length > 0 ? <ActionBar actions={actions} /> : null}
    </li>
  );
}

function FileIcon({ resource }: { resource: FileResource }) {
  const file = resource.attachment;
  if (file.kind === "image") {
    return (
      // Authenticated route with per-request authorisation; next/image cannot fetch it.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={file.hasThumbnail ? `${file.url}?variant=thumb` : file.url}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-10 w-10 shrink-0 rounded-[4px] border border-line bg-paper-2 object-cover"
      />
    );
  }
  return (
    <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[4px] border border-line bg-paper text-ink-3">
      {file.kind === "audio" ? <IconAudio size={15} /> : <IconFile size={15} />}
      <span className="text-[8px] font-medium uppercase leading-none tracking-wide">{attachmentTypeLabel(file.mimeType)}</span>
    </span>
  );
}

// ── Forms, in place of the list ───────────────────────────────────────────

function PanelForm({
  panel,
  scope,
  folders,
  pathOf,
  childrenOf,
  currentFolder,
  accent,
  onCancel,
  onDone,
}: {
  panel: Panel;
  scope: { communityId: string; channelId: string };
  folders: ResourceFolder[];
  pathOf: (folderId: string | undefined) => ResourceFolder[];
  childrenOf: Map<string, ResourceFolder[]>;
  currentFolder?: ResourceFolder;
  accent: string;
  onCancel: () => void;
  onDone: (result: ResourceActionResult) => boolean;
}) {
  const t = useT();
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const ids = { a: useId(), b: useId(), c: useId(), d: useId() };

  // Folders in tree order, for the two folder pickers.
  const ordered = useMemo(() => {
    const out: ResourceFolder[] = [];
    const walk = (parent: string) => {
      for (const folder of childrenOf.get(parent) ?? []) {
        out.push(folder);
        walk(folder.id);
      }
    };
    walk("");
    return out;
  }, [childrenOf]);

  const editing = panel.type === "link" ? panel.link : undefined;
  const [url, setUrl] = useState(editing?.href ?? "");
  const [title, setTitle] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [folderId, setFolderId] = useState(
    panel.type === "move" ? (panel.resource.folderId ?? "") : (currentFolder?.id ?? ""),
  );
  const [name, setName] = useState(panel.type === "folder" ? (panel.folder?.name ?? "") : "");

  function submit(run: () => Promise<ResourceActionResult>) {
    setError(undefined);
    startTransition(async () => {
      const result = await run();
      if (!onDone(result) && !result.ok) setError(result.error);
    });
  }

  const actions = (label: string, danger = false, disabled = false) => (
    <div className="flex flex-wrap justify-end gap-2 pt-1">
      <button type="button" onClick={onCancel} className="h-9 rounded-[5px] px-3 text-sm text-ink-2 hover:bg-paper-2">
        {t("common.cancel")}
      </button>
      <button
        type="submit"
        disabled={pending || disabled}
        className={cn(
          "h-9 rounded-[5px] px-4 text-sm font-medium text-white transition-opacity disabled:opacity-40",
          danger && "bg-rust",
        )}
        style={danger ? undefined : { backgroundColor: accent }}
      >
        {pending ? "…" : label}
      </button>
    </div>
  );

  const errorLine = error ? (
    <p role="alert" className="text-[13px] text-rust">
      {error}
    </p>
  ) : null;

  const heading = (text: string, lead?: string) => (
    <div className="mb-4">
      <h3 className="font-display text-lg leading-snug text-ink">{text}</h3>
      {lead ? <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{lead}</p> : null}
    </div>
  );

  const folderOptions = (
    <>
      <option value="">{t("resources.move.none")}</option>
      {ordered.map((folder) => (
        <option key={folder.id} value={folder.id}>
          {`${" ".repeat(folder.depth - 1)}${folder.name}`}
        </option>
      ))}
    </>
  );

  if (panel.type === "link") {
    return (
      <form
        className="space-y-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          const normalized = normalizeLinkUrl(url);
          if (!normalized) {
            setError(t("err.resourceLinkUrl"));
            return;
          }
          if (!title.trim()) {
            setError(t("err.resourceLinkTitle"));
            return;
          }
          submit(() =>
            editing
              ? updateChannelLinkAction(scope, { linkId: editing.id, url: normalized, title, description })
              : addChannelLinkAction(scope, { folderId: folderId || null, url: normalized, title, description }),
          );
        }}
      >
        {heading(t(editing ? "resources.link.editTitle" : "resources.link.addTitle"), t("resources.link.note"))}
        <div>
          <label htmlFor={ids.a} className="label mb-1 block">
            {t("resources.link.url")}
          </label>
          <input
            id={ids.a}
            // Text, not "url": a bare "docs.google.com/…" is accepted and
            // given https:// by normalizeLinkUrl, which native URL
            // validation would block before it got the chance.
            type="text"
            inputMode="url"
            autoCapitalize="off"
            spellCheck={false}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            maxLength={LINK_URL_MAX}
            required
            autoFocus
            autoComplete="off"
            placeholder={t("resources.link.urlPlaceholder")}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={ids.b} className="label mb-1 block">
            {t("resources.link.title")}
          </label>
          <input
            id={ids.b}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={LINK_TITLE_MAX}
            required
            autoComplete="off"
            placeholder={t("resources.link.titlePlaceholder")}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={ids.c} className="label mb-1 block">
            {t("resources.link.description")}{" "}
            <span className="font-normal normal-case tracking-normal text-ink-3">({t("resources.link.optional")})</span>
          </label>
          <input
            id={ids.c}
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={LINK_DESCRIPTION_MAX}
            autoComplete="off"
            className={fieldClass}
          />
        </div>
        {!editing && folders.length > 0 ? (
          <div>
            <label htmlFor={ids.d} className="label mb-1 block">
              {t("resources.link.folder")}
            </label>
            <select id={ids.d} value={folderId} onChange={(event) => setFolderId(event.target.value)} className={fieldClass}>
              {folderOptions}
            </select>
          </div>
        ) : null}
        {errorLine}
        {actions(editing ? t("common.save") : t("resources.link.add"))}
      </form>
    );
  }

  if (panel.type === "folder") {
    const renaming = panel.folder;
    return (
      <form
        className="space-y-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit(() =>
            renaming
              ? renameResourceFolderAction(scope, { folderId: renaming.id, name })
              : createResourceFolderAction(scope, { parentId: panel.parent?.id ?? null, name }),
          );
        }}
      >
        {heading(
          renaming
            ? t("resources.folder.renameTitle", { name: renaming.name })
            : panel.parent
              ? t("resources.folder.newSubTitle", { name: panel.parent.name })
              : t("resources.folder.newTitle"),
          renaming ? undefined : t("resources.folder.note"),
        )}
        <div>
          <label htmlFor={ids.a} className="label mb-1 block">
            {t("resources.folder.name")}
          </label>
          <input
            id={ids.a}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={RESOURCE_FOLDER_NAME_MAX}
            required
            autoFocus
            autoComplete="off"
            className={fieldClass}
          />
        </div>
        {errorLine}
        {actions(renaming ? t("common.save") : t("resources.folder.create"), false, !name.trim())}
      </form>
    );
  }

  if (panel.type === "move") {
    const resource = panel.resource;
    return (
      <form
        className="space-y-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit(() => moveChannelResourceAction(scope, { type: resource.type, id: resource.id, folderId: folderId || null }));
        }}
      >
        {heading(
          t("resources.move.title", { name: resource.name }),
          resource.type === "file" ? t("resources.move.fileNote") : undefined,
        )}
        {folders.length === 0 ? (
          <p className="text-[13px] text-ink-3">{t("resources.move.noFolders")}</p>
        ) : (
          // min-w-0: a fieldset is as wide as its longest line by default,
          // which would push a long folder name past a phone's edge.
          <fieldset className="min-w-0 space-y-1">
            <legend className="sr-only">{t("resources.link.folder")}</legend>
            {[{ id: "", name: t("resources.move.none"), depth: 1 } as const, ...ordered].map((folder) => (
              <label
                key={folder.id || "none"}
                className="flex cursor-pointer items-center gap-2.5 rounded-[5px] border border-line px-3 py-2 has-[:checked]:border-ink-3"
                style={{ marginLeft: `${(folder.depth - 1) * 1.25}rem` }}
              >
                <input
                  type="radio"
                  name="folder"
                  value={folder.id}
                  checked={folderId === folder.id}
                  onChange={() => setFolderId(folder.id)}
                />
                {folder.id ? <IconFolder size={14} className="shrink-0 text-ink-3" /> : null}
                <span className="min-w-0 truncate text-sm text-ink">{folder.name}</span>
              </label>
            ))}
          </fieldset>
        )}
        {errorLine}
        {actions(t("resources.move.submit"), false, folderId === (resource.folderId ?? ""))}
      </form>
    );
  }

  if (panel.type === "deleteFolder") {
    const folder = panel.folder;
    const subfolders = folders.filter((other) => pathOf(other.id).some((ancestor) => ancestor.id === folder.id) && other.id !== folder.id).length;
    return (
      <form
        className="space-y-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit(() => deleteResourceFolderAction(scope, folder.id));
        }}
      >
        {heading(
          t("resources.deleteFolder.title", { name: folder.name }),
          subfolders > 0
            ? t("resources.deleteFolder.bodySub", { count: subfolders })
            : t("resources.deleteFolder.body"),
        )}
        {errorLine}
        {actions(t("resources.deleteFolder.confirm"), true)}
      </form>
    );
  }

  const link = panel.link;
  return (
    <form
      className="space-y-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit(() => deleteChannelLinkAction(scope, link.id));
      }}
    >
      {heading(t("resources.removeLink.title", { name: link.name }), t("resources.removeLink.body"))}
      {errorLine}
      {actions(t("resources.removeLink.confirm"), true)}
    </form>
  );
}
