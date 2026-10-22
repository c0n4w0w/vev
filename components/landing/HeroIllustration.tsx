import { At, Mark, Person, communities, ink, vars } from "./art";

/**
 * Hero: a gathering circle. One community's channel sits in the middle, the
 * other communities a person belongs to sit around it, and people gather on
 * the ring. Pieces assemble once on load, then a few drift gently.
 */

function Tile({
  x,
  y,
  w,
  community,
  meta,
  delay,
  dur,
}: {
  x: number;
  y: number;
  w: number;
  community: (typeof communities)[keyof typeof communities];
  meta: string;
  delay: number;
  dur: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="l-assemble" style={vars({ "--d": `${delay}ms` })}>
        <g className="l-float" style={vars({ "--dur": dur, "--fd": `${delay / 1000}s` })}>
          <rect x={0} y={4} width={w} height={56} rx={14} fill={ink.spruce} opacity={0.08} />
          <rect width={w} height={56} rx={14} fill={ink.white} stroke={ink.line} />
          <Mark x={11} y={12} size={32} color={community.color} text={community.mono} />
          <text x={52} y={25} fontSize={12} fontWeight={600} fill={ink.ink}>
            {community.name}
          </text>
          <text x={52} y={41} fontSize={10.5} fill={ink.ink3}>
            {meta}
          </text>
        </g>
      </g>
    </g>
  );
}

const people = [
  { x: 70, y: 296, look: { shirt: ink.sage3, skin: 1, hair: 0, style: "short" as const } },
  { x: 108, y: 392, look: { shirt: ink.peach2, skin: 4, hair: 2, style: "long" as const } },
  { x: 184, y: 462, look: { shirt: ink.sky3, skin: 3, hair: 3, style: "curly" as const } },
  { x: 282, y: 488, look: { shirt: ink.lavender2, skin: 0, hair: 1, style: "bun" as const } },
  { x: 386, y: 470, look: { shirt: ink.spruce, skin: 2, hair: 5, style: "short" as const } },
  { x: 532, y: 272, look: { shirt: ink.peach3, skin: 5, hair: 4, style: "cap" as const } },
];

export function HeroIllustration() {
  const kor = communities.kor;
  return (
    <svg
      viewBox="0 0 600 540"
      className="h-auto w-full font-sans"
      role="img"
      aria-label="Illustrasjon: mennesker samlet i en ring rundt en samtale i Kvitveis kor, med andre fellesskap – et turlag, et sykkelkollektiv og en velforening – rundt seg."
    >
      {/* Ground: an organic sage shape and a dashed gathering ring */}
      <g className="l-fade-in">
        <path
          d="M300 34 C438 26 566 112 578 254 C590 396 488 526 326 532 C164 538 28 452 20 300 C12 150 160 42 300 34Z"
          fill={ink.sage}
        />
        <circle cx={62} cy={58} r={44} fill={ink.peach} />
        <circle cx={562} cy={486} r={36} fill={ink.lavender} />
        <circle cx={300} cy={282} r={186} fill="#eaf2eb" />
      </g>
      <circle
        cx={300}
        cy={282}
        r={228}
        fill="none"
        stroke={ink.spruce}
        strokeOpacity={0.28}
        strokeWidth={1.5}
        strokeDasharray="2 8"
        strokeLinecap="round"
        className="l-fade-in"
        style={vars({ "--d": "120ms" })}
      />

      {/* Connections from the other communities into the shared screen */}
      <g fill="none" stroke={ink.spruce} strokeWidth={1.6} strokeLinecap="round" strokeOpacity={0.55}>
        <path d="M98 126 C98 200 132 244 180 246" pathLength={1} className="l-draw-load" style={vars({ "--d": "1000ms" })} />
        <path d="M508 116 C508 172 470 200 420 202" pathLength={1} className="l-draw-load" style={vars({ "--d": "1120ms" })} />
        <path d="M498 400 C498 352 470 322 420 320" pathLength={1} className="l-draw-load" style={vars({ "--d": "1240ms" })} />
      </g>

      {/* People gathered on the ring */}
      {people.map((p, i) => (
        <At key={i} x={p.x} y={p.y} s={1.35}>
          <g className="l-pop-load" style={vars({ "--d": `${300 + i * 90}ms` })}>
            <Person look={p.look} />
          </g>
        </At>
      ))}

      {/* Small speech bubbles */}
      <g transform="translate(86 246)">
        <g className="l-pop-load" style={vars({ "--d": "1500ms" })}>
          <g className="l-float" style={vars({ "--dur": "6s" })}>
            <path d="M0 10 C0 4 4 0 10 0 H32 C38 0 42 4 42 10 C42 16 38 20 32 20 H12 L4 26 L6 19 C2 17 0 14 0 10Z" fill={ink.white} stroke={ink.line} />
            <circle cx={13} cy={10} r={2.2} fill={ink.ink3} />
            <circle cx={21} cy={10} r={2.2} fill={ink.ink3} />
            <circle cx={29} cy={10} r={2.2} fill={ink.ink3} />
          </g>
        </g>
      </g>
      <g transform="translate(540 220)">
        <g className="l-pop-load" style={vars({ "--d": "1650ms" })}>
          <g className="l-float" style={vars({ "--dur": "7.5s", "--fd": "0.8s" })}>
            <path d="M0 10 C0 4 4 0 10 0 H26 C32 0 36 4 36 10 C36 16 32 20 26 20 H10 L4 26 L5 19 C2 17 0 14 0 10Z" fill={ink.peach} />
            <path d="M18 15.5 C13 12 11.5 10 11.5 8 C11.5 6.3 12.8 5 14.4 5 C15.9 5 17 6 18 7.2 C19 6 20.1 5 21.6 5 C23.2 5 24.5 6.3 24.5 8 C24.5 10 23 12 18 15.5Z" fill={ink.peach3} />
          </g>
        </g>
      </g>

      {/* The shared screen: a channel in one community */}
      <g className="l-assemble" style={vars({ "--d": "150ms" })}>
        <rect x={180} y={128} width={240} height={250} rx={16} fill={ink.spruce} opacity={0.1} />
        <rect x={180} y={120} width={240} height={250} rx={16} fill={ink.white} stroke={ink.line} />
        <Mark x={196} y={134} size={26} color={kor.color} text={kor.mono} />
        <text x={230} y={146} fontSize={12} fontWeight={600} fill={ink.ink}>
          {kor.name}
        </text>
        <text x={230} y={159} fontSize={10} fill={ink.ink3}>
          # generelt
        </text>
        <line x1={180} x2={420} y1={172} y2={172} stroke={ink.line} />

        <g className="l-assemble" style={vars({ "--d": "420ms" })}>
          <circle cx={206} cy={194} r={11} fill={ink.lavender} />
          <text x={206} y={194} dy="0.35em" textAnchor="middle" fontSize={8.5} fontWeight={600} fill={ink.lavender3}>
            IH
          </text>
          <text x={224} y={190} fontSize={10.5} fontWeight={600} fill={ink.ink}>
            Ingrid
          </text>
          <text x={262} y={190} fontSize={9} fill={ink.ink3}>
            12:04
          </text>
          <text x={224} y={205} fontSize={10.5} fill={ink.ink2}>
            Notene til lørdag er lagt ut.
          </text>
        </g>

        <g className="l-assemble" style={vars({ "--d": "560ms" })}>
          <circle cx={206} cy={232} r={11} fill={ink.sky} />
          <text x={206} y={232} dy="0.35em" textAnchor="middle" fontSize={8.5} fontWeight={600} fill={ink.sky3}>
            JA
          </text>
          <text x={224} y={228} fontSize={10.5} fontWeight={600} fill={ink.ink}>
            Jonas
          </text>
          <text x={258} y={228} fontSize={9} fill={ink.ink3}>
            12:06
          </text>
          <text x={224} y={243} fontSize={10.5} fill={ink.ink2}>
            Takk! Jeg tar med kaffe.
          </text>
          <rect x={224} y={250} width={36} height={17} rx={8.5} fill={ink.sage} />
          <path
            d="M236 263 C232 260 230.6 258.4 230.6 256.6 C230.6 255.2 231.7 254.1 233 254.1 C234.3 254.1 235.2 254.9 236 255.9 C236.8 254.9 237.7 254.1 239 254.1 C240.3 254.1 241.4 255.2 241.4 256.6 C241.4 258.4 240 260 236 263Z"
            fill={ink.spruce}
          />
          <text x={246} y={262} fontSize={9.5} fontWeight={600} fill={ink.spruce}>
            5
          </text>
        </g>

        {/* An event shared into the channel */}
        <g className="l-assemble" style={vars({ "--d": "700ms" })}>
          <rect x={196} y={280} width={208} height={50} rx={10} fill={ink.cream} />
          <rect x={204} y={287} width={32} height={36} rx={6} fill={ink.white} stroke={ink.line} />
          <text x={220} y={298} textAnchor="middle" fontSize={7} fontWeight={600} fill={ink.peach3} letterSpacing="0.06em">
            LØR
          </text>
          <text x={220} y={315} textAnchor="middle" fontSize={13} fontWeight={600} fill={ink.ink} className="font-display">
            14
          </text>
          <text x={244} y={300} fontSize={10.5} fontWeight={600} fill={ink.ink}>
            Sommerkonsert
          </text>
          <text x={244} y={315} fontSize={9} fill={ink.ink3}>
            18 påmeldt
          </text>
          <rect x={340} y={295} width={56} height={20} rx={10} fill={ink.spruce} />
          <text x={368} y={305} dy="0.35em" textAnchor="middle" fontSize={8.5} fontWeight={600} fill={ink.white}>
            Meld deg på
          </text>
        </g>

        <rect x={196} y={340} width={208} height={22} rx={11} fill={ink.white} stroke={ink.line2} />
        <text x={208} y={351} dy="0.35em" fontSize={9.5} fill={ink.ink3}>
          Skriv i # generelt
        </text>
        <circle cx={392} cy={351} r={7.5} fill={ink.spruce} />
        <path d="M389 351 H395 M392.5 348.5 L395 351 L392.5 353.5" stroke={ink.white} strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* Connection end points */}
      {[
        [180, 246, 1350],
        [420, 202, 1450],
        [420, 320, 1550],
      ].map(([cx, cy, d]) => (
        <g key={`${cx}-${cy}`} transform={`translate(${cx} ${cy})`}>
          <circle r={4.5} fill={ink.spruce} className="l-pop-load" style={vars({ "--d": `${d}ms` })} />
        </g>
      ))}

      {/* The other communities around the circle */}
      <Tile x={18} y={70} w={164} community={communities.tur} meta="3 nye innlegg" delay={620} dur="7s" />
      <Tile x={424} y={60} w={170} community={communities.sykkel} meta="Dugnad i verkstedet" delay={760} dur="8.5s" />
      <Tile x={414} y={400} w={164} community={communities.vel} meta="Styremøte tirsdag" delay={900} dur="7.8s" />
    </svg>
  );
}
