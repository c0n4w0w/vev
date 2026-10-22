import type { CSSProperties, ReactNode } from "react";

/**
 * Shared drawing pieces for the front page illustrations: one palette, one
 * way of drawing people, one way of drawing a community. Everything is plain
 * SVG rendered on the server.
 */

export const ink = {
  spruce: "#214e43",
  spruce2: "#2d6553",
  deep: "#173a30",
  cream: "#f7f1e3",
  paper: "#fbf9f4",
  white: "#ffffff",
  line: "#e4e0d7",
  line2: "#d2ccc0",
  ink: "#17191a",
  ink2: "#4c5153",
  ink3: "#797e81",
  sage: "#dbe8dc",
  sage2: "#9fc0a8",
  sage3: "#5f8a6c",
  sky: "#d8e6ee",
  sky2: "#8fb3c7",
  sky3: "#2f5a73",
  lavender: "#e4def0",
  lavender2: "#a99bc8",
  lavender3: "#5d4f86",
  peach: "#f7dcc8",
  peach2: "#e3a682",
  peach3: "#99442a",
  sand: "#d9cfc0",
  sand2: "#b9a98f",
} as const;

const skins = ["#f2cfae", "#dba57f", "#b07650", "#7d4b31", "#f6dcc4", "#c98f68"];
const hairs = ["#2b2220", "#5a3a26", "#c99a5b", "#1d1b1a", "#8a5a3b", "#d8d2c6"];

export type PersonLook = {
  skin?: number;
  hair?: number;
  shirt: string;
  /** Hair silhouette. */
  style?: "short" | "bun" | "long" | "curly" | "cap" | "none";
};

/**
 * A friendly, faceless bust. Head centre at (0, 0), radius 9; shoulders end at
 * y = 34. Place it with an outer <g transform>.
 */
export function Person({ look }: { look: PersonLook }) {
  const skin = skins[look.skin ?? 0];
  const hair = hairs[look.hair ?? 0];
  const style = look.style ?? "short";
  return (
    <g>
      {style === "long" ? (
        <path d="M-10.5 -1 C-11 10 -9 18 -6 22 L6 22 C9 18 11 10 10.5 -1 Z" fill={hair} />
      ) : null}
      <path d="M-16 34 C-16 19 -8.5 13 0 13 C8.5 13 16 19 16 34 Z" fill={look.shirt} />
      <path d="M-4 13.6 C-2.6 16 2.6 16 4 13.6 C2.6 13.2 -2.6 13.2 -4 13.6Z" fill={skin} opacity={0.9} />
      <circle r={9} fill={skin} />
      {style === "short" || style === "long" ? (
        <path
          d="M-9.4 1 C-10.2 -7.5 -5 -10.8 0.4 -10.6 C6 -10.4 10.4 -7 9.4 1 C8 -3.6 4.4 -5.6 0 -5.4 C-4.4 -5.2 -7.8 -3.4 -9.4 1Z"
          fill={hair}
        />
      ) : null}
      {style === "bun" ? (
        <>
          <circle cx={0} cy={-12} r={4.6} fill={hair} />
          <path
            d="M-9.4 0 C-9.8 -7.5 -5 -10.6 0 -10.6 C5 -10.6 9.8 -7.5 9.4 0 C7.6 -4.6 4 -6 0 -6 C-4 -6 -7.6 -4.6 -9.4 0Z"
            fill={hair}
          />
        </>
      ) : null}
      {style === "curly" ? (
        <g fill={hair}>
          <circle cx={-6} cy={-6} r={5} />
          <circle cx={0} cy={-8.6} r={5.4} />
          <circle cx={6} cy={-6} r={5} />
          <circle cx={-8.6} cy={-1} r={3.4} />
          <circle cx={8.6} cy={-1} r={3.4} />
        </g>
      ) : null}
      {style === "cap" ? (
        <path d="M-9.6 -1.5 C-9.6 -8.6 -4.6 -11 0 -11 C4.6 -11 9.6 -8.6 9.6 -1.5 L13 -1 C13 0 12 0.4 11 0.4 L-9.6 0.4Z" fill={hair} />
      ) : null}
    </g>
  );
}

/** A placed person. `s` scales around the head. */
export function At({
  x,
  y,
  s = 1,
  children,
}: {
  x: number;
  y: number;
  s?: number;
  children: ReactNode;
}) {
  return <g transform={`translate(${x} ${y})${s !== 1 ? ` scale(${s})` : ""}`}>{children}</g>;
}

/** A square community monogram, like `CommunityMark` in the app. */
export function Mark({
  x,
  y,
  size = 28,
  color,
  text,
  serif = true,
}: {
  x: number;
  y: number;
  size?: number;
  color: string;
  text: string;
  serif?: boolean;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={size} height={size} rx={size * 0.2} fill={color} />
      <text
        x={size / 2}
        y={size / 2}
        dy="0.36em"
        textAnchor="middle"
        fontSize={size * 0.38}
        fontWeight={600}
        letterSpacing="0.04em"
        fill="#fff"
        className={serif ? "font-display" : undefined}
      >
        {text}
      </text>
    </g>
  );
}

/** Grey placeholder text lines inside mock interface cards. */
export function Lines({
  x,
  y,
  widths,
  gap = 9,
  color = ink.line,
  h = 5,
}: {
  x: number;
  y: number;
  widths: number[];
  gap?: number;
  color?: string;
  h?: number;
}) {
  return (
    <g>
      {widths.map((w, i) => (
        <rect key={i} x={x} y={y + i * gap} width={w} height={h} rx={h / 2} fill={color} />
      ))}
    </g>
  );
}

/** Inline style helper for CSS custom properties (delays, durations). */
export function vars(v: Record<string, string | number>): CSSProperties {
  return v as CSSProperties;
}

/**
 * The fictional communities used across the page. Plant names, so none of
 * them reads as a real organisation.
 */
export const communities = {
  kor: { name: "Kvitveis kor", mono: "KK", color: "#5d4f86", soft: ink.lavender },
  sykkel: { name: "Eik sykkelkollektiv", mono: "ES", color: "#2f5a73", soft: ink.sky },
  vel: { name: "Bjørk vel", mono: "BV", color: "#99442a", soft: ink.peach },
  tur: { name: "Lyng turlag", mono: "LT", color: "#2d6553", soft: ink.sage },
} as const;
