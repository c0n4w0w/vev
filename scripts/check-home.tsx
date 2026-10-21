/** Home's entry points, bounded digest, empty states and UI languages; no database writes. */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeContent } from "@/components/home/HomeContent";
import { communities as fixtures } from "@/lib/mock/communities";
import { translator, type Locale } from "@/lib/i18n";
import type { HomeEvent, HomeUpdate } from "@/lib/data";
import type { Community } from "@/lib/types";

const communities: Community[] = fixtures.map((community) => ({ ...community, reactionAuthorVisibility: "channel" }));
const community = communities[0];
const updates: HomeUpdate[] = Array.from({ length: 5 }, (_, index) => ({
  id: `update-${index}`,
  communityId: community.id,
  title: index % 2 === 0 ? `Uendret tittel ${index}` : undefined,
  body: `Uendret innlegg ${index} <script>alert(1)</script>`,
  createdAt: "2026-10-21T10:00:00Z",
}));
const events: HomeEvent[] = Array.from({ length: 5 }, (_, index) => ({
  id: `event-${index}`,
  communityId: community.id,
  title: `Uendret arrangement ${index}`,
  startsAt: "2026-12-05T18:00:00Z",
  endsAt: "2026-12-05T20:00:00Z",
  location: "Kabelgata 37, Oslo",
}));

for (const locale of ["nb", "en"] satisfies Locale[]) {
  const t = translator(locale);
  const render = (members: Community[], posts = updates, upcoming = events) => renderToStaticMarkup(
    <HomeContent name="Test Person" communities={members} updates={posts} events={upcoming} locale={locale} />,
  );
  for (const members of [[community], communities]) {
    const html = render(members);
    for (const member of members) {
      assert.ok(html.includes(`href="/community/${member.id}"`));
      assert.ok(html.includes(member.name));
    }
    assert.equal((html.match(/href="[^"]+\/feed#post-/g) ?? []).length, 3);
    assert.equal((html.match(/href="[^"]+\/events\/event-/g) ?? []).length, 3);
    assert.equal((html.match(/line-clamp-2/g) ?? []).length, 3);
    assert.ok(html.includes(`href="/community/${community.id}/feed#post-update-0"`));
    assert.ok(html.includes("Uendret tittel 0"));
    assert.ok(html.includes("Kabelgata 37, Oslo"));
    assert.ok(html.includes("Uendret innlegg 1"), "Untitled posts still have a preview and a link");
    assert.ok(html.includes("&lt;script&gt;"), "User content stays escaped text");
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes("update-3"));
    assert.ok(!html.includes("event-3"));
    assert.ok(!html.includes("<button"), "Home has no post or RSVP controls");
    assert.ok(html.indexOf('id="home-communities"') < html.indexOf('id="home-updates"'));
    assert.ok(html.indexOf('id="home-updates"') < html.indexOf('id="home-events"'));
    assert.ok(html.indexOf('id="home-events"') < html.indexOf(t("home.discovery.body")));
    assert.ok(!html.includes('href="/communities"'));
  }
  const empty = render([]);
  assert.ok(empty.includes(t("platform.home.empty")));
  assert.ok(empty.includes(t("home.discovery.body")));
  assert.ok(!empty.includes('id="home-updates"'), "Zero communities gets a short entry state");
  assert.ok(!empty.includes("/feed#post-"));
  const quiet = render([community], [], []);
  assert.ok(quiet.includes(t("platform.home.noUpdates")));
  assert.ok(quiet.includes(t("platform.home.noEvents")));
  const inaccessible = render([community], [{ ...updates[0], communityId: "outside", title: "Hidden post" }], [{ ...events[0], communityId: "outside", title: "Hidden event" }]);
  assert.ok(!inaccessible.includes("Hidden post"));
  assert.ok(!inaccessible.includes("Hidden event"));
}
console.log("✓ Home: one/several/zero communities, both languages, digest/event limits, links, empty states and isolated content");
