/**
 * Says whether this deployment can send TING's own email, without approving
 * anyone to find out.
 *
 *   npm run email:check                          # settings, connection, login
 *   npm run email:check -- --send-to du@eksempel.no   # …and one test message
 *
 * Reads the same environment the app does (.env.local, then .env), so run it
 * where the app runs. Without --send-to nothing is sent: it connects to the
 * SMTP server, negotiates encryption and logs in, then hangs up.
 *
 * The test message is plain and says what it is. "Accepted" means the SMTP
 * server took it; open the inbox to see that it arrived, and its headers to
 * see what SPF, DKIM and DMARC made of it (see «E-post fra TING» in the README).
 */
import { config } from "dotenv";
import { getEmailProvider } from "@/lib/email/provider";
import { isSingleAddress, SmtpEmailProvider } from "@/lib/email/smtp";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const flag = process.argv.indexOf("--send-to");
  const recipient = flag === -1 ? undefined : process.argv[flag + 1];
  if (flag !== -1 && (!recipient || !isSingleAddress(recipient))) {
    console.error("Bruk: npm run email:check -- --send-to <én e-postadresse>");
    process.exit(1);
  }

  // The app decides its provider under NODE_ENV=production; so does this,
  // unless the shell says otherwise.
  const provider = getEmailProvider({ ...process.env, NODE_ENV: process.env.NODE_ENV ?? "production" });
  console.log(`Leverandør: ${provider.name}`);

  if (!(provider instanceof SmtpEmailProvider)) {
    if (provider.name === "ikke konfigurert") {
      // Sending through it prints the reason, by the names of the settings.
      await provider.send({ to: "ingen@example.invalid", subject: "", text: "", html: "" });
      process.exit(1);
    }
    console.log("Dette er utviklingsleverandøren: e-post skrives til .vev-dev-mail/ og forlater ikke maskinen.");
    return;
  }

  const reachable = await provider.verify();
  if (!reachable.ok) {
    console.error(`✗ ${reachable.error}`);
    process.exit(1);
  }
  console.log("✓ Koblet til SMTP-tjeneren, kryptert og logget inn som oppsettet sier.");

  if (!recipient) return;
  const sent = await provider.send({
    to: recipient,
    subject: "Test av e-post fra TING",
    text: [
      "Dette er en testmelding fra TING.",
      "",
      "Den ble sendt med `npm run email:check` for å kontrollere at installasjonen kan sende e-post.",
      "Du trenger ikke å gjøre noe.",
    ].join("\n"),
    html: "<p>Dette er en testmelding fra TING.</p><p>Den ble sendt med <code>npm run email:check</code> for å kontrollere at installasjonen kan sende e-post. Du trenger ikke å gjøre noe.</p>",
  });
  if (!sent.ok) {
    console.error(`✗ ${sent.error}`);
    process.exit(1);
  }
  console.log("✓ SMTP-tjeneren tok imot testmeldingen. Se i innboksen at den kom fram.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
