import { At, Lines, Mark, Person, communities, ink } from "./art";

/**
 * Three small scenes for the privacy promises. Each reacts when its card is
 * hovered (see `.l-ad`, `.l-tag`, `.l-key` in landing.css).
 */

/** An ad banner peeling off a conversation. */
export function NoAdsArt() {
  return (
    <svg viewBox="0 0 320 200" className="h-auto w-full font-sans" aria-hidden="true">
      <circle cx={262} cy={40} r={56} fill="#fbe9dc" />
      <rect x={58} y={30} width={170} height={150} rx={16} fill={ink.white} stroke="#ecd3c1" />
      <At x={84} y={64} s={0.9}>
        <circle r={11} fill={ink.lavender} />
      </At>
      <rect x={102} y={54} width={96} height={22} rx={11} fill={ink.lavender} />
      <rect x={110} y={88} width={96} height={22} rx={11} fill={ink.sage} />
      <At x={218} y={98} s={0.9}>
        <circle r={11} fill={ink.sage2} />
      </At>
      <rect x={102} y={122} width={70} height={22} rx={11} fill={ink.lavender} />
      <At x={84} y={132} s={0.9}>
        <circle r={11} fill={ink.lavender} />
      </At>
      <rect x={74} y={154} width={138} height={16} rx={8} fill="none" stroke={ink.line2} />

      {/* The banner, falling away */}
      <g transform="translate(232 96)">
        <g className="l-ad">
          <g transform="rotate(16)">
            <rect x={-54} y={-22} width={108} height={44} rx={6} fill="#fff7f0" stroke={ink.peach3} strokeDasharray="4 4" strokeWidth={1.4} />
            <text y={0} dy="0.35em" textAnchor="middle" fontSize={13} fontWeight={700} letterSpacing="0.12em" fill={ink.peach3}>
              ANNONSE
            </text>
            <line x1={-46} x2={46} y1={0} y2={0} stroke={ink.peach3} strokeWidth={2.4} strokeLinecap="round" />
          </g>
        </g>
      </g>
      <path d="M282 150 q8 6 4 14 M296 140 q8 6 4 14" fill="none" stroke={ink.peach2} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

/** A stack of member cards with a "not for sale" tag. */
export function NotForSaleArt() {
  return (
    <svg viewBox="0 0 320 200" className="h-auto w-full font-sans" aria-hidden="true">
      <circle cx={60} cy={150} r={60} fill="#e8f0f5" />
      {[
        { x: 70, y: 70, r: -6 },
        { x: 80, y: 58, r: -2 },
        { x: 92, y: 46, r: 2 },
      ].map((c, i) => (
        <g key={i} transform={`translate(${c.x} ${c.y}) rotate(${c.r})`}>
          <rect width={150} height={96} rx={12} fill={ink.white} stroke="#cddce4" />
          {i === 2 ? (
            <>
              <At x={30} y={34} s={0.9}>
                <Person look={{ shirt: ink.sky3, skin: 2, hair: 0, style: "short" }} />
              </At>
              <Lines x={56} y={26} widths={[70, 48]} gap={12} h={6} />
              <rect x={56} y={58} width={40} height={14} rx={4} fill={ink.sky} />
            </>
          ) : null}
        </g>
      ))}
      {/* The tag hangs from a string pinned to the top card */}
      <circle cx={230} cy={52} r={3.5} fill={ink.sky3} />
      <g transform="translate(230 52)">
        <g className="l-tag">
          <path d="M0 0 C6 18 4 30 10 42" fill="none" stroke={ink.sky3} strokeWidth={1.4} />
          <g transform="translate(10 42) rotate(12)">
            <path d="M-12 0 H50 C54 0 56 2 56 6 V36 C56 40 54 42 50 42 H-12 L-26 21Z" fill={ink.sky3} />
            <circle cx={-12} cy={21} r={3} fill="#e8f0f5" />
            <text x={21} y={15} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={ink.white}>
              Ikke til
            </text>
            <text x={21} y={29} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={ink.white}>
              salgs
            </text>
          </g>
        </g>
      </g>
    </svg>
  );
}

/** The organisation's own key, with its mark on the tag. */
export function OwnKeyArt() {
  const kor = communities.tur;
  return (
    <svg viewBox="0 0 320 200" className="h-auto w-full font-sans" aria-hidden="true">
      <circle cx={250} cy={150} r={64} fill="#e9f1ea" />
      {/* A doorway into the community's own space */}
      <path d="M196 180 V92 C196 62 216 44 244 44 C272 44 292 62 292 92 V180Z" fill={ink.spruce} />
      <path d="M210 180 V96 C210 72 224 58 244 58 C264 58 278 72 278 96 V180Z" fill={ink.sage} />
      <At x={232} y={124} s={1}>
        <Person look={{ shirt: ink.sage3, skin: 3, hair: 3, style: "curly" }} />
      </At>
      <At x={258} y={130} s={0.9}>
        <Person look={{ shirt: ink.peach2, skin: 0, hair: 2, style: "long" }} />
      </At>
      <rect x={210} y={160} width={68} height={20} fill={ink.sage2} />

      <g transform="translate(96 112)">
        <g className="l-key">
          <circle r={36} fill={ink.spruce} />
          <circle r={22} fill={ink.cream} />
          <Mark x={-14} y={-14} size={28} color={kor.color} text={kor.mono} />
          <path d="M34 -6 H118 V6 H108 V22 H96 V6 H84 V16 H72 V6 H34Z" fill={ink.spruce} />
        </g>
      </g>
      <path d="M40 54 l6 6 M52 44 l2 9 M30 68 l9 2" stroke={ink.sage3} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}
