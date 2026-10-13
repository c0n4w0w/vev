/**
 * Removes message attachments that were uploaded but never sent, and any
 * stored files whose attachment is gone.
 *
 * The app does both on its own as people use it (after an upload, after a
 * removed file, after a deleted group or channel). This is the same work on a
 * schedule, for a deployment where a quiet day should not leave abandoned
 * uploads lying in the private bucket:
 *
 *   npm run attachments:sweep            # unsent uploads older than 24 hours
 *   npm run attachments:sweep -- 6       # …older than 6 hours
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY. Touches nothing that was ever sent.
 *
 * Exits non-zero, with the count and the age of the oldest entry, if any file
 * is still waiting to be removed afterwards — the signal to look at Storage.
 */
import { config } from "dotenv";
import { sweepAbandonedAttachments } from "@/lib/attachment-storage";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const hours = Number(process.argv[2] ?? 24);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.error("Bruk: npm run attachments:sweep -- <timer>");
    process.exit(1);
  }
  const result = await sweepAbandonedAttachments(hours);
  console.log(`✓ ${result.swept} forlatte opplastinger ryddet, ${result.removed} filer fjernet`);
  // Anything still queued is a stored file that should be gone and is not.
  // Say so, and fail, so whatever runs this on a schedule notices.
  if (result.remaining > 0) {
    console.error(
      `✗ ${result.remaining} filer står fortsatt i slettekøen` +
        (result.oldestQueuedAt ? ` (eldste fra ${result.oldestQueuedAt})` : "") +
        ". De er ikke lenger lesbare for noen, og forsøkes fjernet igjen ved neste kjøring.",
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
