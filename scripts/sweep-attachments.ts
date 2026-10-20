/**
 * Deletes disappearing direct messages whose time is up, removes message
 * attachments that were uploaded but never sent, and any stored files whose
 * attachment is gone.
 *
 * The app does both on its own as people use it (after an upload, after a
 * removed file, after a deleted group or channel). This is the same work on a
 * schedule, for a deployment where a quiet day should not leave abandoned
 * uploads lying in the private bucket:
 *
 *   npm run attachments:sweep            # unsent uploads older than 24 hours
 *   npm run attachments:sweep -- 6       # …older than 6 hours
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY. Touches nothing that was ever sent, except
 * disappearing messages the database reports as expired — which nobody can
 * read any more already; this removes their text and files for good.
 *
 * Exits non-zero, with the count and the age of the oldest entry, if any file
 * is still waiting to be removed afterwards — the signal to look at Storage —
 * and if any message that had expired before the run is still in the
 * database afterwards. On the server this runs every five minutes from
 * deploy/systemd/ting-sweep.timer, which mails an operator on failure.
 */
import { config } from "dotenv";
import { purgeExpiredDirectMessages, sweepAbandonedAttachments } from "@/lib/attachment-storage";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const hours = Number(process.argv[2] ?? 24);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.error("Bruk: npm run attachments:sweep -- <timer>");
    process.exit(1);
  }
  const expired = await purgeExpiredDirectMessages({ verify: true });
  const result = await sweepAbandonedAttachments(hours);
  console.log(
    `✓ ${expired.expired} utløpte forsvinnende meldinger slettet, ${result.swept} forlatte opplastinger ryddet, ` +
      `${expired.removed + result.removed} filer fjernet`,
  );
  // Anything still queued is a stored file that should be gone and is not;
  // any expired message still here is text that should be gone and is not.
  // Say so, and fail, so whatever runs this on a schedule notices.
  let clean = true;
  if (expired.expiredLeft !== 0) {
    console.error(
      expired.expiredLeft === null
        ? "✗ Kunne ikke kontrollere om utløpte forsvinnende meldinger er slettet."
        : `✗ ${expired.expiredLeft} utløpte forsvinnende meldinger er fortsatt lagret. ` +
            "De er ikke lenger lesbare for noen, og forsøkes slettet igjen ved neste kjøring.",
    );
    clean = false;
  }
  if (result.remaining > 0) {
    console.error(
      `✗ ${result.remaining} filer står fortsatt i slettekøen` +
        (result.oldestQueuedAt ? ` (eldste fra ${result.oldestQueuedAt})` : "") +
        ". De er ikke lenger lesbare for noen, og forsøkes fjernet igjen ved neste kjøring.",
    );
    clean = false;
  }
  if (!clean) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
