"use client";

import { useEffect, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@/components/ui/icons";
import { useT } from "@/lib/i18n/react";
import type { MessageAttachment } from "@/lib/attachment-types";
import { ToolbarButton, ViewerMessage, ViewerNote, ViewerToolbar, useAttachmentBytes } from "./shared";

type Paragraph = { text: string; level: number };
type Slide = { title?: string; paragraphs: Paragraph[]; tables: string[][][] };

/** No slide's XML is anywhere near this; an entry that claims to be is refused. */
const MAX_PART_BYTES = 8 * 1024 * 1024;
const MAX_SLIDES = 300;

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function parseXml(bytes: Uint8Array): Document | undefined {
  const xml = new DOMParser().parseFromString(new TextDecoder("utf-8").decode(bytes), "application/xml");
  return xml.getElementsByTagName("parsererror").length > 0 ? undefined : xml;
}

/** The text of one DrawingML paragraph: its runs, fields and line breaks. */
function paragraphText(paragraph: Element): string {
  let text = "";
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (child.namespaceURI !== NS_A) continue;
      if (child.localName === "t") text += child.textContent ?? "";
      else if (child.localName === "br") text += "\n";
      else if (child.localName === "r" || child.localName === "fld") walk(child);
    }
  };
  walk(paragraph);
  return text.replace(/[ \t]+\n/g, "\n").trim();
}

function paragraphsOf(body: Element): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const child of Array.from(body.children)) {
    if (child.namespaceURI !== NS_A || child.localName !== "p") continue;
    const text = paragraphText(child);
    if (!text) continue;
    const properties = Array.from(child.children).find((node) => node.localName === "pPr");
    const level = Math.min(4, Math.max(0, Number(properties?.getAttribute("lvl") ?? 0) || 0));
    paragraphs.push({ text, level });
  }
  return paragraphs;
}

function readSlide(xml: Document): Slide {
  const slide: Slide = { paragraphs: [], tables: [] };

  for (const shape of Array.from(xml.getElementsByTagNameNS(NS_P, "sp"))) {
    const body = Array.from(shape.children).find(
      (node) => node.namespaceURI === NS_P && node.localName === "txBody",
    );
    if (!body) continue;
    const paragraphs = paragraphsOf(body);
    if (paragraphs.length === 0) continue;

    const placeholder = shape.getElementsByTagNameNS(NS_P, "ph")[0]?.getAttribute("type");
    if (!slide.title && (placeholder === "title" || placeholder === "ctrTitle")) {
      slide.title = paragraphs.map((paragraph) => paragraph.text).join(" ");
    } else {
      slide.paragraphs.push(...paragraphs);
    }
  }

  for (const table of Array.from(xml.getElementsByTagNameNS(NS_A, "tbl"))) {
    const rows = Array.from(table.children)
      .filter((node) => node.namespaceURI === NS_A && node.localName === "tr")
      .map((row) =>
        Array.from(row.children)
          .filter((node) => node.namespaceURI === NS_A && node.localName === "tc")
          .map((cell) => {
            const body = Array.from(cell.children).find((node) => node.localName === "txBody");
            return body
              ? paragraphsOf(body)
                  .map((paragraph) => paragraph.text)
                  .join("\n")
              : "";
          }),
      );
    if (rows.length > 0) slide.tables.push(rows);
  }

  return slide;
}

/**
 * The slides of a presentation, in presentation order, as text.
 *
 * Only three kinds of part are ever decompressed — the presentation, its
 * relationships and the slides — and each only if it is small. Pictures,
 * media, embedded objects and anything else in the archive are never opened.
 */
async function readPresentation(bytes: ArrayBuffer): Promise<Slide[]> {
  const { unzipSync } = await import("fflate");
  const wanted = /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml)$/;
  const parts = unzipSync(new Uint8Array(bytes), {
    filter: (entry) => wanted.test(entry.name) && entry.originalSize <= MAX_PART_BYTES,
  });

  const presentation = parts["ppt/presentation.xml"] && parseXml(parts["ppt/presentation.xml"]);
  const relationships =
    parts["ppt/_rels/presentation.xml.rels"] && parseXml(parts["ppt/_rels/presentation.xml.rels"]);

  let order: string[] = [];
  if (presentation && relationships) {
    const targets = new Map<string, string>();
    for (const relationship of Array.from(relationships.getElementsByTagName("Relationship"))) {
      const id = relationship.getAttribute("Id");
      const target = relationship.getAttribute("Target");
      if (id && target) targets.set(id, `ppt/${target.replace(/^\/?(ppt\/)?/, "")}`);
    }
    order = Array.from(presentation.getElementsByTagNameNS(NS_P, "sldId"))
      .map((slide) => targets.get(slide.getAttributeNS(NS_R, "id") ?? "") ?? "")
      .filter((name) => name in parts);
  }
  if (order.length === 0) {
    // No usable ordering: fall back to the numbers in the part names.
    const number = (name: string) => Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0);
    order = Object.keys(parts)
      .filter((name) => name.startsWith("ppt/slides/"))
      .sort((a, b) => number(a) - number(b));
  }

  return order.slice(0, MAX_SLIDES).flatMap((name) => {
    const xml = parseXml(parts[name]);
    return xml ? [readSlide(xml)] : [];
  });
}

/**
 * A presentation, slide by slide — as text.
 *
 * This is deliberately not a rendering of the slides. Drawing PowerPoint's
 * layout faithfully needs a conversion service, and the alternative — handing
 * the file to somebody else's online viewer — is exactly what a private
 * conversation must not do. What can be shown safely and honestly is what
 * each slide says: its title, its text with the outline levels kept, and its
 * tables. Everything is read as XML and placed on the page as text; nothing
 * from the file is drawn, linked or run. The note above the slide says so,
 * and the download is one click away.
 */
export function PresentationViewer({ attachment }: { attachment: MessageAttachment }) {
  const t = useT();
  const file = useAttachmentBytes(attachment);
  const [slides, setSlides] = useState<Slide[] | "error" | undefined>(undefined);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (file.status !== "ready") return;
    let cancelled = false;
    readPresentation(file.bytes)
      .then((result) => {
        if (!cancelled) setSlides(result.length > 0 ? result : "error");
      })
      .catch(() => {
        if (!cancelled) setSlides("error");
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const total = Array.isArray(slides) ? slides.length : 0;

  useEffect(() => {
    if (total < 2) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft" || event.key === "PageUp") setIndex((value) => Math.max(0, value - 1));
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        setIndex((value) => Math.min(total - 1, value + 1));
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [total]);

  if (file.status === "error" || slides === "error") {
    return <ViewerMessage tone="error">{t("attachments.previewFailed")}</ViewerMessage>;
  }
  if (!slides) return <ViewerMessage>{t("attachments.loading")}</ViewerMessage>;

  const slide = slides[index];
  const empty = !slide.title && slide.paragraphs.length === 0 && slide.tables.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar>
        <ToolbarButton
          label={t("attachments.previousSlide")}
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
          disabled={index === 0}
        >
          <IconChevronLeft size={17} />
        </ToolbarButton>
        <span className="min-w-[8.5rem] text-center tabular-nums" aria-live="polite">
          {t("attachments.slide", { current: index + 1, total })}
        </span>
        <ToolbarButton
          label={t("attachments.nextSlide")}
          onClick={() => setIndex((value) => Math.min(total - 1, value + 1))}
          disabled={index >= total - 1}
        >
          <IconChevronRight size={17} />
        </ToolbarButton>
      </ViewerToolbar>
      <ViewerNote>{t("attachments.pptxNote")}</ViewerNote>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-4 sm:px-8 sm:py-8" tabIndex={0}>
        <article className="mx-auto min-h-[16rem] max-w-3xl rounded-[6px] border border-line bg-surface px-6 py-7 sm:px-10 sm:py-9">
          {empty ? (
            <p className="text-sm text-ink-3">{t("attachments.emptySlide")}</p>
          ) : (
            <>
              {slide.title ? (
                <h3 className="font-display text-[1.5rem] leading-tight text-ink">{slide.title}</h3>
              ) : null}
              {slide.paragraphs.length > 0 ? (
                <div className={slide.title ? "mt-5 space-y-2" : "space-y-2"}>
                  {slide.paragraphs.map((paragraph, position) => (
                    <p
                      key={position}
                      className="whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-2"
                      style={{ paddingLeft: `${paragraph.level * 1.25}rem` }}
                    >
                      {paragraph.text}
                    </p>
                  ))}
                </div>
              ) : null}
              {slide.tables.map((rows, position) => (
                <div key={position} className="mt-5 overflow-x-auto">
                  <table className="border-collapse text-[13px] text-ink">
                    <tbody>
                      {rows.map((cells, row) => (
                        <tr key={row}>
                          {cells.map((cell, column) => (
                            <td
                              key={column}
                              className="whitespace-pre-line border border-line-2 px-2.5 py-1.5 align-top"
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </>
          )}
        </article>
      </div>
    </div>
  );
}
