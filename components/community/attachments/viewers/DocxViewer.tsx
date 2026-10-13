"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/react";
import type { MessageAttachment } from "@/lib/attachment-types";
import { ViewerMessage, ViewerNote, useAttachmentBytes } from "./shared";

/** Everything a Word document's structure needs, and nothing that can act. */
const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br", "hr", "blockquote", "pre",
  "strong", "b", "em", "i", "u", "s", "sup", "sub", "span",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "th", "td",
  "img",
];
const ALLOWED_ATTR = ["colspan", "rowspan", "src", "alt"];
/** Pictures embedded in the document itself; never an address to fetch. */
const EMBEDDED_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;

const FRAME_STYLE = `
  :root { color-scheme: light; }
  html { background: #ffffff; }
  body {
    margin: 0 auto; padding: 32px 28px 56px; max-width: 46rem;
    font: 15px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #17191a; overflow-wrap: anywhere;
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.5em; font-weight: 600; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.3rem; } h3 { font-size: 1.1rem; }
  h4, h5, h6 { font-size: 1rem; }
  body > :first-child { margin-top: 0; }
  p { margin: 0 0 0.9em; }
  ul, ol { margin: 0 0 0.9em; padding-left: 1.5em; }
  blockquote { margin: 0 0 0.9em; padding-left: 1em; border-left: 3px solid #d2ccc0; color: #4c5153; }
  table { border-collapse: collapse; margin: 0 0 1.1em; max-width: 100%; display: block; overflow-x: auto; }
  th, td { border: 1px solid #d2ccc0; padding: 6px 10px; vertical-align: top; text-align: left; }
  th { background: #f6f4ef; font-weight: 600; }
  img { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; }
`;

/**
 * The page handed to the frame. Its own policy allows nothing but inline
 * style and embedded pictures: no script, no network, no form, no frame.
 */
function frameDocument(body: string, language: string): string {
  return [
    "<!doctype html>",
    `<html lang="${language}"><head><meta charset="utf-8">`,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`,
    `<meta name="referrer" content="no-referrer">`,
    `<style>${FRAME_STYLE}</style>`,
    `</head><body>${body}</body></html>`,
  ].join("");
}

/**
 * A Word document as formatted, read-only text: headings, paragraphs, lists,
 * tables and embedded pictures. Not a page-accurate rendering — fonts,
 * columns, headers and footers are not reproduced — and it says so.
 *
 * Three independent layers keep a document from doing anything:
 *
 *   1. mammoth reads the document's XML and writes fresh markup from it. A
 *      macro, an embedded object or a field is simply not something it emits.
 *   2. That markup is sanitised to a short list of structural elements. Links
 *      lose their address and stay as text; an image must be a picture
 *      embedded in the file, not something to fetch.
 *   3. The result is shown in a frame with scripting, forms, navigation and
 *      same-origin access all switched off, under a policy of its own that
 *      permits no script and no network. The frame cannot reach the session
 *      or the conversation even if both earlier layers were wrong.
 */
export function DocxViewer({ attachment }: { attachment: MessageAttachment }) {
  const t = useT();
  const file = useAttachmentBytes(attachment);
  const [state, setState] = useState<{ html: string } | "empty" | "error" | undefined>(undefined);

  useEffect(() => {
    if (file.status !== "ready") return;
    let cancelled = false;
    (async () => {
      try {
        const [mammothModule, { default: DOMPurify }] = await Promise.all([
          import("mammoth/mammoth.browser"),
          import("dompurify"),
        ]);
        // A CommonJS bundle: depending on the bundler it arrives as the
        // module itself or under `default`.
        const mammoth = mammothModule.default ?? mammothModule;
        const { value } = await mammoth.convertToHtml({ arrayBuffer: file.bytes });
        const clean = DOMPurify.sanitize(value, {
          ALLOWED_TAGS,
          ALLOWED_ATTR,
          ALLOW_DATA_ATTR: false,
          ALLOW_ARIA_ATTR: false,
          ALLOWED_URI_REGEXP: EMBEDDED_IMAGE,
        });
        if (cancelled) return;
        const hasContent = /<img\b/i.test(clean) || clean.replace(/<[^>]*>/g, "").trim().length > 0;
        setState(hasContent ? { html: clean } : "empty");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (file.status === "error" || state === "error") {
    return <ViewerMessage tone="error">{t("attachments.previewFailed")}</ViewerMessage>;
  }
  if (!state) return <ViewerMessage>{t("attachments.loading")}</ViewerMessage>;
  if (state === "empty") return <ViewerMessage>{t("attachments.emptyDocument")}</ViewerMessage>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerNote>{t("attachments.docxNote")}</ViewerNote>
      <iframe
        title={attachment.name}
        // Empty: no scripts, no forms, no popups, no top navigation, and an
        // origin of its own that shares nothing with this page.
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={frameDocument(state.html, document.documentElement.lang || "nb")}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
