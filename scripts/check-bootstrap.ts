/**
 * Checks the production bootstrap without needing an empty database.
 *
 * 1. The definition itself: what it carries over from the repository, and
 *    what it must never carry — fixture accounts, their links, member counts.
 * 2. Against the seeded local stack, as a dry run: the bootstrap and the
 *    showcase seed must agree on every row both create. A seeded database is
 *    therefore one the bootstrap finds complete, with nothing to add and
 *    nothing that differs — and the dry run must leave it untouched.
 * 3. The first-administrator rules, against the fixture accounts: every
 *    refusal, and that asking changes nothing.
 *
 * The other half — an empty database becoming a working installation — needs
 * an empty database, which this stack is not. It is described in the README
 * («Første installasjon») and is what `npm run bootstrap` prints.
 *
 * Run with `npm run check:bootstrap` against the local stack after
 * `npm run seed`. Reads only.
 */
import { config } from "dotenv";
import { applyBootstrap } from "@/lib/bootstrap/apply";
import { planFirstAdministrator } from "@/lib/bootstrap/administrator";
import { channelGroupRows, communityDefinitions, DIRECTORY_INCLUDED, directoryLeftOut } from "@/lib/bootstrap/definition";
import { demoPersonas } from "@/lib/mock/demo-personas";
import { users } from "@/lib/mock/users";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

config({ path: ".env.local" });
config({ path: ".env" });

const admin = createSupabaseAdminClient();

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`\n✗ ${label}\n    forventet: ${expected}\n    fikk:      ${actual}`);
}

const FTR = "tryggere-ruspolitikk";
const TU = "tryggere-ungdom";
const UTR = "under-the-rug";

function checkDefinition() {
  const byId = new Map(communityDefinitions.map((definition) => [definition.community.id, definition]));
  expect("definisjon: de tre fellesskapene, og bare dem", [...byId.keys()].sort().join(","), [FTR, TU, UTR].sort().join(","));

  for (const [id, definition] of byId) {
    const { community } = definition;
    expect(`${id}: slug er id-en`, community.slug, id);
    expect(`${id}: ingen medlemstall — det telles, ikke lagres`, "member_count" in community, false);
    // A community starts with no channels and no sections: its administrators
    // create their own. Nothing in the definition can carry one.
    expect(`${id}: ingen kanaler i definisjonen`, "channels" in definition, false);
    expect(`${id}: ingen kanalseksjoner i definisjonen`, "sections" in definition, false);
    expect(`${id}: About-teksten viser ikke til kanaler som ikke finnes`, /#[a-zæøå]/i.test(community.about), false);
    expect(`${id}: første lenke er organisasjonens nettsted`, /^https:\/\//.test((community.links as { href: string }[])[0]?.href ?? ""), true);
    expect(`${id}: ber om tilgang, ikke åpen`, community.access_policy, "request-to-join");
  }

  // What migrations only ever corrected on an existing row.
  expect("UTR: engelsk (20260927100000)", byId.get(UTR)?.community.default_locale, "en");
  expect("FTR: bokmål", byId.get(FTR)?.community.default_locale, "nb");
  expect("TU: bokmål", byId.get(TU)?.community.default_locale, "nb");
  expect("TU: landsdekkende, 2018 (20261015100000)", `${byId.get(TU)?.community.location}/${byId.get(TU)?.community.founded_year}`, "Landsdekkende/2018");
  expect("TU: nettsted (20261015100000)", JSON.stringify((byId.get(TU)?.community.links as unknown[])[0]), '{"label":"tryggereungdom.no","href":"https://tryggereungdom.no"}');
  expect("FTR: landsdekkende (20261015100000)", byId.get(FTR)?.community.location, "Landsdekkende");
  expect(
    "FTR: lenker (20261015100000)",
    JSON.stringify(byId.get(FTR)?.community.links),
    '[{"label":"rusreform.no","href":"https://rusreform.no"},{"label":"Bli medlem","href":"https://rusreform.no/bli-medlem"}]',
  );
  const safeSpace = byId.get(FTR)?.subgroups ?? [];
  expect("FTR: Safe-Space frivillige (20261005100000)", safeSpace.map((subgroup) => subgroup.slug).join(","), "safe-space-frivillige");
  expect("FTR: … som moderatorene leser (20261022100000)", safeSpace[0]?.moderators_read, true);
  expect("TU og UTR: ingen grupper", `${byId.get(TU)?.subgroups.length}/${byId.get(UTR)?.subgroups.length}`, "0/0");
  const staff = (name: string) => byId.get(FTR)?.people.find((person) => person.section === "staff" && person.name === name)?.email;
  expect("FTR: kontaktadresser (20261017100000)", `${staff("Mia Minge")}/${staff("Erlend Thonstad")}`, "mia@rusreform.no/erlend@rusreform.no");

  // Privacy settings.
  expect("FTR: lukket medlemsliste, bare ansvarlige sender meldinger", `${byId.get(FTR)?.community.member_directory_visibility}/${byId.get(FTR)?.community.dm_policy}`, "admin_only/staff_only");
  expect("TU: samme", `${byId.get(TU)?.community.member_directory_visibility}/${byId.get(TU)?.community.dm_policy}`, "admin_only/staff_only");
  expect("UTR: åpen for medlemmer", `${byId.get(UTR)?.community.member_directory_visibility}/${byId.get(UTR)?.community.dm_policy}`, "members/members");

  // Structure.
  expect("FTR: sju lokallag", byId.get(FTR)?.localGroups.length, 7);
  expect("TU: fem lokallag", byId.get(TU)?.localGroups.length, 5);
  expect("UTR: ingen lokallag", byId.get(UTR)?.localGroups.length, 0);
  expect("lokallag: slug uten æøå", byId.get(FTR)?.localGroups.find((group) => group.name === "FTR Trøndelag")?.slug, "ftr-trondelag");
  expect("plattformoverskrifter i rekkefølge, og bare dem", channelGroupRows.map((group) => `${group.id}:${group.position}`).join(","), "lokallag:0,grupper:1");

  // The directory: one organisation's, and never an account.
  expect("katalog: bare FTR er tatt med", [...DIRECTORY_INCLUDED].join(","), FTR);
  expect("katalog: FTR har kortene sine", (byId.get(FTR)?.people.length ?? 0) > 0, true);
  expect("katalog: TU og UTR starter tomme", `${byId.get(TU)?.people.length}/${byId.get(UTR)?.people.length}`, "0/0");
  expect("katalog: … og det sies fra om hva som er utelatt", directoryLeftOut(TU) > 0 && directoryLeftOut(UTR) > 0 && directoryLeftOut(FTR) === 0, true);
  const serialized = JSON.stringify(communityDefinitions);
  expect("ingen kobling til en konto noe sted", /user_?id/i.test(serialized), false);
  const fixtureAddress = [...users, ...demoPersonas].find((user) => serialized.includes(user.email));
  expect("ingen testkontos adresse noe sted", fixtureAddress?.email, undefined);
  expect(
    "lokallagsledere peker på et lokallag som finnes",
    byId.get(FTR)?.people.filter((person) => person.section === "local_group_leader").every((person) =>
      byId.get(FTR)?.localGroups.some((group) => group.slug === person.local_group_slug),
    ),
    true,
  );
}

const TABLES = ["communities", "channel_groups", "channel_sections", "channels", "community_local_groups", "community_subgroups", "community_people", "memberships"] as const;

async function fingerprint(): Promise<string> {
  const parts: string[] = [];
  for (const table of TABLES) {
    const { data, error } = await admin.from(table).select("*").order("id");
    if (error) throw error;
    parts.push(JSON.stringify(data));
  }
  return parts.join("\n");
}

async function checkAgainstSeed() {
  const before = await fingerprint();
  const report = await applyBootstrap(admin, { write: false });
  expect("seedet database: ingenting å opprette", report.created.join("; "), "");
  // An administrator may rename a channel or rewrite the About text in the
  // app, and on a stack someone has been working in, someone has. Those are
  // the differences the bootstrap exists to leave alone; any other is a
  // definition that has drifted from the seed.
  const editable = /^(kanal \S+ \((name|purpose)(, (name|purpose))*\)|fellesskap \S+ \(about\))$/;
  const edited = report.differs.filter((line) => editable.test(line));
  if (edited.length > 0) console.log(`  (endret i appen siden seed, og latt i fred: ${edited.join("; ")})`);
  expect("seedet database: ingenting avviker", report.differs.filter((line) => !editable.test(line)).join("; "), "");
  expect("seedet database: plattformoverskriftene står i rekkefølge", report.corrected.join("; "), "");
  expect("seedet database: bootstrapen ville ikke opprettet noen kanal", report.created.some((line) => /kanal/.test(line)), false);
  // Every row the definition holds is there — as defined, or edited since.
  const defined =
    channelGroupRows.length +
    communityDefinitions.reduce((sum, d) => sum + 1 + d.localGroups.length + d.subgroups.length + d.people.length, 0);
  expect("seedet database: alt i definisjonen finnes", report.present.length + report.differs.length, defined);
  expect("tørrkjøringen endret ingenting", (await fingerprint()) === before, true);
}

async function checkAdministratorRules() {
  const before = await fingerprint();
  const plan = async (community: string, email: string, allowFixtures = true) => {
    const result = await planFirstAdministrator(admin, { community, email, allowFixtures });
    return result.ok ? `ok:${result.action}` : result.reason;
  };
  const emailOf = (id: string) => [...users, ...demoPersonas].find((user) => user.id === id)!.email;

  expect("admin: ikke en adresse", /ikke en e-postadresse/.test(await plan(FTR, "ikke en adresse")), true);
  expect("admin: testkontoer avvises utenfor showcase", /testkontoer/.test(await plan(FTR, emailOf("jonas"), false)), true);
  expect("admin: ukjent fellesskap", /finnes ikke/.test(await plan("finnes-ikke", emailOf("jonas"))), true);
  expect("admin: ingen konto med adressen", /Ingen TING-konto/.test(await plan(FTR, "ingen.slik.konto@example.org")), true);
  // Fixture accounts have no password, which is exactly the refusal to see.
  expect("admin: konto uten passord", /ikke noe passord/.test(await plan(UTR, emailOf("jonas"))), true);
  expect("admin: … også når kontoen alt er administrator", /ikke noe passord/.test(await plan(FTR, emailOf("mia-minge"))), true);
  expect("admin: å spørre endret ingenting", (await fingerprint()) === before, true);
}

async function main() {
  checkDefinition();
  await checkAgainstSeed();
  await checkAdministratorRules();

  if (failures > 0) {
    console.error(`\n✗ ${failures} av ${checks} oppstartskontroller feilet.\n`);
    process.exit(1);
  }
  console.log(`✓ ${checks} oppstartskontroller passerte`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
