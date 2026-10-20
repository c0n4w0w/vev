/**
 * Tells an operator by email that a scheduled job failed.
 *
 *   npm run -s ops:alert -- <unit>      # e.g. ting-sweep.service
 *
 * Meant for systemd's OnFailure= (deploy/systemd/ting-sweep-alert.service),
 * so a sweep that fails in the night does not go unnoticed. The address is
 * TING_OPS_ALERT_EMAIL; the mail goes out the same way as TING's own email
 * (EMAIL_PROVIDER, SMTP_*), from the same environment the app reads.
 *
 * The message names the unit, the host and the time, and says where to look.
 * It never quotes the job's output: the journal is the place for that, and a
 * log line can name a message or a file.
 *
 * Exits non-zero if nothing could be sent, so the alert's own failure is in
 * the journal too.
 */
import { hostname } from "node:os";
import { config } from "dotenv";
import { getEmailProvider } from "@/lib/email/provider";
import { isSingleAddress } from "@/lib/email/smtp";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const unit = process.argv[2] ?? "ukjent jobb";
  const recipient = process.env.TING_OPS_ALERT_EMAIL?.trim();
  console.error(`[ops] ${unit} feilet`);
  if (!recipient || !isSingleAddress(recipient)) {
    console.error("[ops] TING_OPS_ALERT_EMAIL er ikke satt til én adresse; ingen e-post sendt.");
    process.exit(1);
  }

  const provider = getEmailProvider({ ...process.env, NODE_ENV: process.env.NODE_ENV ?? "production" });
  const host = hostname();
  const when = new Date().toISOString();
  const text = [
    `${unit} feilet på ${host} (${when}).`,
    "",
    "Se loggen på serveren:",
    `  journalctl -u ${unit} -n 50`,
    "",
    "For opprydding av forsvinnende meldinger betyr det at utløpte meldinger eller filer kan ligge",
    "lagret lenger enn de skal. De er fortsatt uleselige for alle; databasen nekter tilgang fra utløpstiden.",
    "",
    "Flere feil den neste timen gir ikke flere e-poster.",
  ].join("\n");
  const sent = await provider.send({
    to: recipient,
    subject: `TING: ${unit} feilet på ${host}`,
    text,
    html: `<pre style="font-family: ui-monospace, monospace; white-space: pre-wrap">${text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")}</pre>`,
  });
  if (!sent.ok) {
    console.error(`[ops] varselet kunne ikke sendes: ${sent.error}`);
    process.exit(1);
  }
  console.error(`[ops] varsel sendt (${provider.name})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
