import { deflateSync } from "node:zlib";

/**
 * How some fixture people present themselves differently per community.
 *
 * Everyone else keeps the profile the membership trigger gives them — their
 * account name and bio, copied once into each community — which is also what
 * existing accounts got when community profiles were introduced. These
 * entries exist so the demo shows the point of the feature: one account,
 * three unrelated faces.
 *
 * Kari (the Tryggere showcase persona) is her full name with a professional
 * bio in the parent organisation and just "Kari" in the youth wing, with a
 * different photo in each. She has no Under The Rug membership on purpose
 * (see `demo-personas.ts`), so the pseudonym case is Ingrid's: the fixture
 * that already spans both organisations uses a stage name in the collective.
 */
export interface CommunityProfileFixture {
  userId: string;
  communityId: string;
  displayName: string;
  bio: string;
  /** Generated at seed time; see `avatarPng`. */
  avatar?: { background: [number, number, number]; foreground: [number, number, number] };
}

export const communityProfiles: CommunityProfileFixture[] = [
  {
    userId: "demo-tryggere",
    communityId: "tryggere-ruspolitikk",
    displayName: "Kari Moen",
    bio: "Organisasjonsrådgiver i Tryggere Ruspolitikk. Følger opp høringer, medlemsarbeid og samarbeid med lokallagene.",
    avatar: { background: [40, 80, 63], foreground: [214, 230, 220] },
  },
  {
    userId: "demo-tryggere",
    communityId: "tryggere-ungdom",
    displayName: "Kari",
    bio: "Kontaktperson fra moderorganisasjonen. Spør meg om arrangementer, stands og hvem du skal snakke med.",
    avatar: { background: [196, 106, 60], foreground: [252, 232, 214] },
  },
  {
    userId: "ingrid",
    communityId: "tryggere-ungdom",
    displayName: "Ingrid",
    bio: "Kontakt fra moderorganisasjonen, mest opptatt av frivillighet og vaktlister.",
  },
  {
    userId: "ingrid",
    communityId: "under-the-rug",
    displayName: "Lavfrekvens",
    bio: "Lyd, kabler og for mye sub. Står bak miksepulten når det er åpen kveld.",
    avatar: { background: [52, 36, 84], foreground: [230, 120, 190] },
  },
];

// ── Generated photos ────────────────────────────────────────────────────
//
// A plain disc on a flat background, as a real PNG, so the seed needs no
// binary files and each profile's photo is unmistakably different from the
// others in a screenshot.

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(Buffer.from(type, "latin1"), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function avatarPng(
  background: [number, number, number],
  foreground: [number, number, number],
  size = 160,
): Uint8Array {
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, size);
  hv.setUint32(4, size);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB

  const centre = size / 2;
  const radius = size * 0.3;
  const rows: Uint8Array[] = [];
  for (let y = 0; y < size; y += 1) {
    const row = new Uint8Array(1 + size * 3);
    for (let x = 0; x < size; x += 1) {
      // Head and shoulders: a disc, and a wider one cut off by the bottom edge.
      const head = Math.hypot(x - centre, y - size * 0.4) < radius * 0.8;
      const body = Math.hypot(x - centre, y - size * 1.05) < radius * 1.6;
      const colour = head || body ? foreground : background;
      row.set(colour, 1 + x * 3);
    }
    rows.push(row);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
