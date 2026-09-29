/**
 * Checks the related-community card's relationship config and state rules.
 *
 * Pure logic — no database. Run with `npm run check:related-communities`.
 */
import {
  getRelatedCommunityConfig,
  isActiveMember,
  relatedCommunityHref,
} from "@/lib/related-communities";
import { getTryggerePortalBrand } from "@/lib/tryggere-portal";
import { nb } from "@/lib/i18n/nb";
import { en } from "@/lib/i18n/en";

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  if (String(actual) === String(expected)) return;
  failures += 1;
  console.error(`✗ ${label}\n    expected: ${expected}\n    got:      ${actual}`);
}

const ftr = getRelatedCommunityConfig("tryggere-ruspolitikk");
const tu = getRelatedCommunityConfig("tryggere-ungdom");
expect("FTR resolves TU", ftr?.targetSlug, "tryggere-ungdom");
expect("TU resolves FTR", tu?.targetSlug, "tryggere-ruspolitikk");
expect("FTR → TU membership url", ftr?.membershipUrl, "https://tryggere-ungdom.no");
expect("TU → FTR membership url", tu?.membershipUrl, "https://rusreform.no/bli-medlem")
expect("TU → FTR reuses the portal config url", tu?.membershipUrl, getTryggerePortalBrand("tryggere-ruspolitikk")?.membershipUrl);
expect("unrelated community resolves none", getRelatedCommunityConfig("under-the-rug"), undefined);
expect("prototype keys resolve none", getRelatedCommunityConfig("constructor"), undefined);
expect("display name does not resolve", getRelatedCommunityConfig("Tryggere Ruspolitikk"), undefined);

expect("active counts", isActiveMember({ status: "active" }), true);
expect("no membership does not count", isActiveMember(undefined), false);
for (const status of ["pending", "invited", "removed", "left", "declined"] as const) {
  expect(`${status} does not count`, isActiveMember({ status: status as never }), false);
}

const target = { id: "tryggere-ungdom", slug: "tryggere-ungdom" };
expect("non-member goes to portal", relatedCommunityHref(target, false), "/tryggere-ungdom");
expect("member goes to community", relatedCommunityHref(target, true), "/community/tryggere-ungdom");

for (const cfg of [ftr, tu]) {
  for (const key of [cfg?.copy.lead, cfg?.copy.body]) {
    if (!key) continue;
    expect(`nb has ${key}`, key in nb, true);
    expect(`en has ${key}`, key in en, true);
  }
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("related communities: ok");
