import { getCollaborationBySlug, hasCollaborationAccess } from "@/lib/collaboration-data";
import {
  COLLABORATION_FILE_MAX_BYTES,
  detectCollaborationFileType,
} from "@/lib/collaboration-file-type";
import { uploadFile } from "@/lib/collaboration-workspace-data";
import { FILE_NAME_MAX, cleanDisplayName } from "@/lib/collaboration-workspace-form";
import { translator } from "@/lib/i18n";
import { getSessionUser } from "@/lib/session";
import { siteOrigin } from "@/lib/site-url";

/**
 * Upload one file into one collaboration.
 *
 * A route handler of its own, so the 8 MiB collaboration-file cap does not
 * have to widen the request limit of every server action in the app (that
 * stays at next.config's 6 MB). This path accepts exactly one thing, and
 * refuses as early as it can:
 *
 *   1. same origin only — the session cookie is SameSite=Lax already, and this
 *      is the second lock a server action would otherwise provide;
 *   2. a signed-in session (401 otherwise);
 *   3. a collaboration the viewer can see, by its slug (404 otherwise);
 *   4. effective collaboration access (403) — checked BEFORE the body is read,
 *      so a representative outside the team, or anyone else, is turned away
 *      without the server parsing their upload;
 *   5. a declared size within the cap (413), then the real size (413);
 *   6. the type, from the bytes (415).
 *
 * The object is then written with the viewer's own session — the storage
 * policy requires access AND a collaboration profile, and decides the
 * collaboration from the object name, which is built here from a fresh uuid
 * and the verified type, never from anything the client sent. The database
 * registration re-reads size and type from what Storage stored. No service
 * role is involved anywhere.
 *
 * Replies are JSON in the collaboration's language: `{ ok, message, id? }`.
 */
export const dynamic = "force-dynamic";

/** Room for the multipart envelope and the other two small fields. */
const MULTIPART_ALLOWANCE = 64 * 1024;

function reply(status: number, body: { ok: boolean; message: string; id?: string }) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function sameOrigin(request: Request): Promise<boolean> {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin]);
  try {
    allowed.add(new URL(await siteOrigin()).origin);
  } catch {
    // No usable configured origin: the request's own origin is the only one.
  }
  return allowed.has(origin);
}

export async function POST(request: Request, context: RouteContext<"/collaboration/[slug]/files/upload">) {
  const { slug } = await context.params;
  const fallback = translator("nb");

  if (!(await sameOrigin(request))) return reply(403, { ok: false, message: fallback("ws.files.failed") });

  const user = await getSessionUser();
  if (!user) return reply(401, { ok: false, message: fallback("ws.files.failed") });

  const collaboration = await getCollaborationBySlug(slug);
  if (!collaboration) return reply(404, { ok: false, message: fallback("ws.files.failed") });
  const t = translator(collaboration.defaultLocale);
  const max = COLLABORATION_FILE_MAX_BYTES / (1024 * 1024);

  if (!(await hasCollaborationAccess(collaboration.id))) {
    return reply(403, { ok: false, message: t("ws.files.failed") });
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > COLLABORATION_FILE_MAX_BYTES + MULTIPART_ALLOWANCE) {
    return reply(413, { ok: false, message: t("ws.files.tooLarge", { max }) });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reply(400, { ok: false, message: t("ws.files.noFile") });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return reply(400, { ok: false, message: t("ws.files.noFile") });
  if (file.size > COLLABORATION_FILE_MAX_BYTES) return reply(413, { ok: false, message: t("ws.files.tooLarge", { max }) });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > COLLABORATION_FILE_MAX_BYTES) {
    return reply(413, { ok: false, message: t("ws.files.tooLarge", { max }) });
  }
  const type = detectCollaborationFileType(bytes, file.name);
  if (!type) return reply(415, { ok: false, message: t("ws.files.badType") });

  const chosen = cleanDisplayName(String(form.get("displayName") ?? ""));
  const displayName = Array.from(chosen || cleanDisplayName(file.name) || type.extension)
    .slice(0, FILE_NAME_MAX)
    .join("")
    .trim();

  const id = await uploadFile({
    collaborationId: collaboration.id,
    fileId: crypto.randomUUID(),
    extension: type.extension,
    mimeType: type.mimeType,
    displayName,
    bytes,
  });
  if (!id) return reply(403, { ok: false, message: t("ws.files.failed") });

  return reply(201, { ok: true, message: t("ws.files.uploaded", { name: displayName }), id });
}
