/**
 * Shapes and pure helpers for the platform administration forms.
 *
 * Kept free of any database or server import so client components can use
 * them for instant feedback. Nothing here is a security boundary: every rule
 * is checked again by the database functions in
 * supabase/migrations/20261113100000_platform_administration.sql, which are
 * the only ones a direct caller cannot skip.
 */

export type PlatformFormState = {
  status: "idle" | "ok" | "error";
  message?: string;
  /** Field-level problems, keyed by input name. */
  fields?: Record<string, string>;
  /** Where to go next, for forms that create something. */
  href?: string;
};

export const idleState: PlatformFormState = { status: "idle" };

/**
 * Words the site uses at the top level. A portal lives at `/<slug>`, so a
 * community called "login" would shadow the login page. Mirrors
 * `platform_identifier_is_valid()` in the database.
 */
export const RESERVED_IDENTIFIERS: ReadonlySet<string> = new Set([
  "admin", "api", "app", "apple-icon", "arrangement", "auth", "bekreft-e-post", "brand",
  "collaboration", "collaborations", "communities", "community", "demo", "emoji-catalog",
  "events", "favicon", "glemt-passord", "hjelp", "home", "icon", "invitasjon", "kontakt",
  "login", "logout", "manifest", "next", "notifications", "nytt-passord", "om",
  "opprett-passord", "personvern", "platform", "platform-admin", "profile", "robots",
  "samarbeid", "settings", "sitemap", "static", "support", "ting", "velkommen", "vilkar", "www",
]);

export function identifierProblem(value: string): string | undefined {
  if (value.length < 3) return "Minst tre tegn.";
  if (value.length > 50) return "Høyst 50 tegn.";
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(value)) {
    return "Bare små bokstaver a–z, tall og bindestrek, og ikke bindestrek først eller sist.";
  }
  if (value.includes("--")) return "Ikke to bindestreker etter hverandre.";
  if (RESERVED_IDENTIFIERS.has(value)) return "Dette ordet brukes av nettstedet selv.";
  return undefined;
}

/** A slug suggestion from a name: æ→ae, ø→o, å→a, everything else to hyphens. */
export function suggestIdentifier(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
    .replace(/-$/, "");
}

/** Up to three initials, the way the existing communities' monograms read (TR, TU, UTR). */
export function suggestMonogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  const initials = words.map((word) => word[0]).join("").toUpperCase();
  return (initials || "T").slice(0, 3);
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/.test(value);
}

/**
 * The soft tint used behind the accent: the accent mixed into white, about
 * 11 % strength — the ratio the existing communities' pairs share
 * (#2f5a73 → #e7eef2).
 */
export function softAccent(accent: string): string {
  if (!isHexColor(accent)) return "#e8efea";
  const channel = (offset: number) => {
    const value = parseInt(accent.slice(offset, offset + 2), 16);
    return Math.round(255 - (255 - value) * 0.115)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/** Relative luminance, for warning about an accent white text cannot sit on. */
export function contrastWithWhite(accent: string): number {
  if (!isHexColor(accent)) return 1;
  const linear = (offset: number) => {
    const value = parseInt(accent.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
  return 1.05 / (luminance + 0.05);
}

export const ACCENT_PRESETS = [
  { value: "#1f4a3d", label: "Skog" },
  { value: "#2f5a73", label: "Fjord" },
  { value: "#3f7f77", label: "Havgrønn" },
  { value: "#99442a", label: "Falurød" },
  { value: "#9a5a3c", label: "Rust" },
  { value: "#633066", label: "Plomme" },
  { value: "#3b3b40", label: "Grafitt" },
] as const;

export const ACCESS_POLICY_LABELS = {
  "invite-only": "Bare invitasjon",
  "request-to-join": "Kan be om tilgang",
} as const;

export const DIRECTORY_LABELS = {
  admin_only: "Bare administrator ser medlemslisten",
  members: "Alle medlemmer ser medlemslisten",
} as const;

export const DM_POLICY_LABELS = {
  staff_only: "Medlemmer kan bare skrive til ansvarlige som tar imot det",
  members: "Alle medlemmer kan sende direktemeldinger til hverandre",
} as const;

export const LOCALE_LABELS = { nb: "Norsk bokmål", en: "Engelsk" } as const;

export const MARK_STYLE_LABELS = { sans: "Rett", serif: "Antikva", mono: "Monospace" } as const;

export function looksLikeEmail(value: string): boolean {
  return value.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}
