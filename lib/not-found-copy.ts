/**
 * The words on a 404, in one place.
 *
 * Two different things render this page. `app/not-found.tsx` is the ordinary
 * React one, styled with the app's Tailwind tokens. The showcase entry route
 * (`app/demo/[token]/route.ts`) is a route handler — it has to hand back a
 * finished HTML document, because a handler cannot render a page — so it
 * builds its own markup from these same strings.
 *
 * Keeping the copy here means the two can drift in styling, which is visible,
 * but never in what they say, which would not be.
 */
export const notFoundCopy = {
  label: "Ikke funnet",
  heading: "Vi finner ikke denne siden",
  body:
    "Adressen kan være feilskrevet, eller så peker den til et fellesskap du ikke har tilgang " +
    "til. TING viser ikke hvilke fellesskap som finnes, så vi kan dessverre ikke foreslå noe " +
    "liknende.",
  links: [
    { href: "/", label: "Til forsiden", variant: "secondary" },
    { href: "/home", label: "Til fellesskapene mine", variant: "primary" },
  ],
} as const;
