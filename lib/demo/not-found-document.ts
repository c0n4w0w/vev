import "server-only";

import { notFoundCopy } from "@/lib/not-found-copy";

/**
 * A complete 404 document, built by hand.
 *
 * The showcase entry point is a route handler, not a page: establishing the
 * session means writing cookies, and only a handler or a Server Action may do
 * that. A handler cannot render `app/not-found.tsx` — `notFound()` inside one
 * produces a bare status with no body, which is how this route came to answer
 * a blank white screen.
 *
 * So the handler serves this instead: one self-contained file, styles inline,
 * no stylesheet to fetch and no script to run. It says exactly what the app's
 * own 404 says, because both read `notFoundCopy`.
 *
 * Nothing from the request appears in the output. The token is never echoed —
 * not in the markup, not in a link — so a wrong token cannot be reflected back
 * into the page.
 */

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );

// Mirrors the tokens in app/globals.css. Inlined rather than imported because
// this document is served without the app's stylesheet.
const styles = `
  :root { color-scheme: light }
  * { box-sizing: border-box }
  body {
    margin: 0;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: #f6f4ef;
    color: #17191a;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  header { border-bottom: 1px solid #e4e0d7; background: #ffffff }
  .bar { max-width: 48rem; margin: 0 auto; padding: 1rem 1.25rem }
  .wordmark {
    font-family: ui-serif, Georgia, serif;
    font-size: 1.0625rem;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: #17191a;
    text-decoration: none;
  }
  main {
    width: 100%;
    max-width: 48rem;
    margin: 0 auto;
    padding: 5rem 1.25rem;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .label {
    font-size: 0.6875rem;
    line-height: 1;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: #797e81;
    margin: 0;
  }
  h1 {
    font-family: ui-serif, Georgia, serif;
    font-weight: 400;
    font-size: 2rem;
    line-height: 1.2;
    letter-spacing: -0.012em;
    margin: 0.75rem 0 0;
  }
  p.body { margin: 0.75rem 0 0; max-width: 32rem; font-size: 0.9375rem; line-height: 1.7; color: #4c5153 }
  .actions { margin-top: 2rem; display: flex; flex-wrap: wrap; gap: 0.75rem }
  a.btn {
    display: inline-flex;
    align-items: center;
    border-radius: 0.5rem;
    padding: 0.625rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
    border: 1px solid transparent;
  }
  a.primary { background: #1f4a3d; color: #ffffff }
  a.secondary { background: #ffffff; color: #17191a; border-color: #d2ccc0 }
  @media (min-width: 1024px) { .bar, main { padding-left: 2rem; padding-right: 2rem } }
`;

export function notFoundDocument(): string {
  const actions = notFoundCopy.links
    .map(
      (link) =>
        `<a class="btn ${link.variant}" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`,
    )
    .join("");

  return `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(notFoundCopy.label)} · TING</title>
<style>${styles}</style>
</head>
<body>
<header><div class="bar"><a class="wordmark" href="/">TING</a></div></header>
<main>
<p class="label">${escapeHtml(notFoundCopy.label)}</p>
<h1>${escapeHtml(notFoundCopy.heading)}</h1>
<p class="body">${escapeHtml(notFoundCopy.body)}</p>
<div class="actions">${actions}</div>
</main>
</body>
</html>`;
}
