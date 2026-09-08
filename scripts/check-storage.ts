/**
 * Checks that custom emoji metadata and their image files stay in step.
 *
 * The delete flow touches two systems that cannot share a transaction, so the
 * pair can only be kept consistent by ordering the writes carefully. This is
 * the regression test for that: it runs against the live local database and
 * fails if either kind of dangling reference has appeared.
 *
 *   orphaned object — a file nothing points at. Invisible, accumulates, and
 *                     the reason the delete removes the file first.
 *   dangling row    — a row whose image is gone. Visible (the emoji renders as
 *                     its name) and fixable by deleting it again.
 *
 * Run with `npm run check:storage` after exercising emoji uploads or deletes.
 * Uses the service role, so it sees everything regardless of row level
 * security — which is the point: an orphan is invisible to a normal caller.
 */
import { config } from "dotenv";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { communities } from "@/lib/mock/communities";

config({ path: ".env.local" });
config({ path: ".env" });

const BUCKET = "community-emoji";
const supabase = createSupabaseAdminClient();

async function main() {
  const { data: rows, error } = await supabase
    .from("community_emojis")
    .select("id, community_id, name, storage_path");

  if (error) {
    console.error(`\n✗ Klarte ikke lese community_emojis: ${error.message}`);
    process.exit(1);
  }

  // List every object in the bucket, one community prefix at a time.
  const objects = new Set<string>();
  for (const community of communities) {
    const { data: listed } = await supabase.storage.from(BUCKET).list(community.id);
    for (const entry of listed ?? []) objects.add(`${community.id}/${entry.name}`);
  }

  const metadata = rows ?? [];
  const referenced = new Set(metadata.map((row) => row.storage_path));

  const orphanedObjects = [...objects].filter((path) => !referenced.has(path));
  const danglingRows = metadata.filter((row) => !objects.has(row.storage_path));

  // Every file must live under its own community's prefix. A row whose path
  // points into another community would let one community's moderators reach
  // another's file through the storage policies, which key off that prefix.
  const misplaced = metadata.filter(
    (row) => row.storage_path.split("/")[0] !== row.community_id,
  );

  const problems: string[] = [
    ...orphanedObjects.map((path) => `foreldreløs fil i bøtta: ${path}`),
    ...danglingRows.map((row) => `rad uten fil: ${row.community_id}/:${row.name}: -> ${row.storage_path}`),
    ...misplaced.map((row) => `filen ligger under feil fellesskap: ${row.storage_path} tilhører ${row.community_id}`),
  ];

  if (problems.length > 0) {
    console.error(`\n✗ ${problems.length} problem(er):\n`);
    for (const problem of problems) console.error(`  · ${problem}`);
    process.exit(1);
  }

  console.log(`✓ ${metadata.length} emojier, ${objects.size} filer, ingen avvik`);
}

main();
