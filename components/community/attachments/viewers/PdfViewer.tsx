"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { IconChevronLeft, IconChevronRight, IconZoomIn, IconZoomOut } from "@/components/ui/icons";
import { useT } from "@/lib/i18n/react";
import type { MessageAttachment } from "@/lib/attachment-types";
import { ToolbarButton, ViewerMessage, ViewerToolbar, useAttachmentBytes } from "./shared";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const FIT = ZOOM_STEPS.indexOf(1);
/** The widest a page is drawn at 100 %: comfortable to read, not a wall. */
const FIT_MAX_WIDTH = 920;
/** A cap on one canvas, so a zoomed-in page cannot exhaust a phone's memory. */
const MAX_CANVAS_PIXELS = 12_000_000;

type PageSize = { width: number; height: number };

/**
 * One page, drawn onto a canvas the first time it scrolls near the window and
 * redrawn when the zoom changes. Until then it is an empty sheet of the right
 * size, so the scrollbar is honest about how long the document is.
 */
function PdfPage({
  document: pdf,
  number,
  width,
  fallback,
  register,
  scroller,
}: {
  document: PDFDocumentProxy;
  number: number;
  /** CSS pixels the page should be wide. */
  width: number;
  /** The first page's shape, used until this page's own is known. */
  fallback: PageSize;
  register: (number: number, element: HTMLDivElement | null) => void;
  /** The scrolling column the pages live in. */
  scroller: React.RefObject<HTMLDivElement | null>;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [size, setSize] = useState<PageSize>(fallback);

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      // Measured against the column, not the window, so a page starts
      // drawing a screenful before it scrolls into view.
      { root: scroller.current, rootMargin: "800px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [scroller]);

  useEffect(() => {
    if (!near || width <= 0) return;
    let cancelled = false;
    let task: RenderTask | undefined;

    (async () => {
      const page = await pdf.getPage(number);
      if (cancelled || !canvas.current) return;

      const base = page.getViewport({ scale: 1 });
      setSize({ width: base.width, height: base.height });

      const cssScale = width / base.width;
      let pixelScale = cssScale * Math.min(window.devicePixelRatio || 1, 2);
      const pixels = base.width * base.height * pixelScale * pixelScale;
      if (pixels > MAX_CANVAS_PIXELS) pixelScale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);

      const viewport = page.getViewport({ scale: pixelScale });
      const target = canvas.current;
      target.width = Math.floor(viewport.width);
      target.height = Math.floor(viewport.height);

      // Pixels only. No annotation layer is built, so nothing in the file —
      // a link, a form field, a script action — exists to be activated.
      task = page.render({ canvas: target, viewport });
      await task.promise;
    })().catch(() => {
      // A cancelled render, or a page that cannot be drawn: the sheet stays blank.
    });

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, number, pdf, width]);

  return (
    <div
      ref={(element) => {
        holder.current = element;
        register(number, element);
      }}
      data-page={number}
      className="mx-auto bg-white shadow-[0_1px_3px_rgba(23,25,26,0.14)]"
      style={{ width, height: (width * size.height) / size.width }}
    >
      <canvas ref={canvas} className="block h-full w-full" />
    </div>
  );
}

/**
 * A PDF, read inside the conversation: every page in one scrolling column,
 * with page-by-page navigation and zoom.
 *
 * Rendered by pdf.js to canvases from the bytes the authenticated route
 * returned. The browser's own PDF plugin is never involved, nothing is sent
 * to a third-party viewer, and the document's scripts, forms and embedded
 * files are not run or offered: only its pages are painted.
 */
export function PdfViewer({ attachment }: { attachment: MessageAttachment }) {
  const t = useT();
  const file = useAttachmentBytes(attachment);
  const [pdf, setPdf] = useState<PDFDocumentProxy | "error" | undefined>(undefined);
  const [firstPage, setFirstPage] = useState<PageSize | undefined>(undefined);
  const [zoomStep, setZoomStep] = useState(FIT);
  const [current, setCurrent] = useState(1);
  const [available, setAvailable] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const pages = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    if (file.status !== "ready") return;
    let cancelled = false;
    // Destroying the loading task shuts down the document and its worker.
    let task: { destroy: () => Promise<void> } | undefined;

    (async () => {
      try {
        // The legacy build runs on the browsers people actually have on
        // older phones; the worker is bundled with the app, not fetched from
        // anywhere else.
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
            import.meta.url,
          ).toString();
        }
        // A copy: pdf.js hands the buffer to its worker and keeps it.
        const loading = pdfjs.getDocument({
          data: new Uint8Array(file.bytes.slice(0)),
          enableXfa: false,
          useWorkerFetch: false,
          disableAutoFetch: true,
          disableStream: true,
        });
        task = loading;
        const loaded = await loading.promise;
        const first = (await loaded.getPage(1)).getViewport({ scale: 1 });
        if (cancelled) return;
        setFirstPage({ width: first.width, height: first.height });
        setPdf(loaded);
      } catch {
        // Password-protected, damaged, or not something pdf.js can read.
        if (!cancelled) setPdf("error");
      }
    })();

    return () => {
      cancelled = true;
      void task?.destroy().catch(() => undefined);
    };
  }, [file]);

  // The room there is for a page, kept up to date as the window changes.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setAvailable(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [pdf]);

  const register = useCallback((number: number, element: HTMLDivElement | null) => {
    if (element) pages.current.set(number, element);
    else pages.current.delete(number);
  }, []);

  // Which page is being read: the last one whose top is above the middle.
  const onScroll = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const middle = element.getBoundingClientRect().top + element.clientHeight / 2;
    let page = 1;
    for (const [number, node] of pages.current) {
      if (node.getBoundingClientRect().top <= middle && number > page) page = number;
    }
    setCurrent(page);
  }, []);

  const goTo = useCallback((number: number) => {
    pages.current.get(number)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  if (file.status === "error" || pdf === "error") {
    return <ViewerMessage tone="error">{t("attachments.previewFailed")}</ViewerMessage>;
  }
  if (!pdf || !firstPage) return <ViewerMessage>{t("attachments.loading")}</ViewerMessage>;

  const total = pdf.numPages;
  const zoom = ZOOM_STEPS[zoomStep];
  const gutter = available < 640 ? 16 : 48;
  const fitWidth = Math.max(160, Math.min(available - gutter, FIT_MAX_WIDTH));
  const pageWidth = available > 0 ? Math.round(fitWidth * zoom) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar>
        <ToolbarButton
          label={t("attachments.previousPage")}
          onClick={() => goTo(Math.max(1, current - 1))}
          disabled={current <= 1}
        >
          <IconChevronLeft size={17} />
        </ToolbarButton>
        <span className="min-w-[6.5rem] text-center tabular-nums" aria-live="polite">
          {t("attachments.page", { current, total })}
        </span>
        <ToolbarButton
          label={t("attachments.nextPage")}
          onClick={() => goTo(Math.min(total, current + 1))}
          disabled={current >= total}
        >
          <IconChevronRight size={17} />
        </ToolbarButton>
        <span className="mx-1.5 h-4 w-px bg-line-2" aria-hidden="true" />
        <ToolbarButton
          label={t("attachments.zoomOut")}
          onClick={() => setZoomStep((value) => Math.max(0, value - 1))}
          disabled={zoomStep === 0}
        >
          <IconZoomOut size={17} />
        </ToolbarButton>
        <button
          type="button"
          onClick={() => setZoomStep(FIT)}
          aria-label={t("attachments.zoomReset")}
          title={t("attachments.zoomReset")}
          className="min-w-[3.25rem] rounded-[5px] px-2 py-1 tabular-nums transition-colors hover:bg-paper-2"
        >
          {Math.round(zoom * 100)} %
        </button>
        <ToolbarButton
          label={t("attachments.zoomIn")}
          onClick={() => setZoomStep((value) => Math.min(ZOOM_STEPS.length - 1, value + 1))}
          disabled={zoomStep === ZOOM_STEPS.length - 1}
        >
          <IconZoomIn size={17} />
        </ToolbarButton>
      </ViewerToolbar>

      <div ref={scroller} onScroll={onScroll} tabIndex={0} className="min-h-0 flex-1 overflow-auto bg-paper-2">
        {pageWidth > 0 ? (
          <div className="flex min-w-max flex-col gap-3 px-2 py-3 sm:gap-4 sm:px-6 sm:py-5">
            {Array.from({ length: total }, (_, index) => (
              <PdfPage
                key={index + 1}
                document={pdf}
                number={index + 1}
                width={pageWidth}
                fallback={firstPage}
                register={register}
                scroller={scroller}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
