import { At, Mark, Person, communities, ink, vars } from "./art";

/**
 * Two organisations, each with its own members, and a shared collaboration
 * room between them. When revealed, the two circles slide in, the links draw,
 * and a few chosen people from each side walk into the shared room — while
 * every member dot stays inside its own organisation.
 *
 * Drawn twice: wide for tablet/desktop, stacked for phones.
 */

const dots = [
  [-62, -46], [-22, -70], [24, -62], [64, -34], [-86, -4], [-44, -14], [4, -24], [46, 4],
  [84, 20], [-70, 40], [-26, 30], [20, 40], [60, 58], [-40, 72], [6, 80], [-90, -40],
];

function Members({ cx, cy, fill, light }: { cx: number; cy: number; fill: string; light: string }) {
  return (
    <g>
      {dots.map(([dx, dy], i) => (
        <g key={i} transform={`translate(${cx + dx} ${cy + dy})`}>
          <circle r={6.5} fill={i % 3 === 0 ? light : fill} />
          <path d="M-9 17 C-9 10.5 -5 8 0 8 C5 8 9 10.5 9 17Z" fill={i % 3 === 0 ? light : fill} opacity={0.75} />
        </g>
      ))}
    </g>
  );
}

function Org({
  cx,
  cy,
  r,
  community,
  ring,
  dotFill,
  dotLight,
  labelY,
}: {
  cx: number;
  cy: number;
  r: number;
  community: (typeof communities)[keyof typeof communities];
  ring: string;
  dotFill: string;
  dotLight: string;
  labelY: number;
}) {
  const label = community.name;
  const w = label.length * 7.4 + 44;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={ring} fillOpacity={0.12} stroke={ring} strokeOpacity={0.6} strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={r - 14} fill="none" stroke={ring} strokeOpacity={0.25} strokeDasharray="2 6" strokeLinecap="round" />
      <Members cx={cx} cy={cy - 6} fill={dotFill} light={dotLight} />
      <g transform={`translate(${cx - w / 2} ${labelY})`}>
        <rect width={w} height={30} rx={15} fill={ink.deep} stroke={ring} strokeOpacity={0.5} />
        <Mark x={5} y={4} size={22} color={community.color} text={community.mono} />
        <text x={34} y={15} dy="0.35em" fontSize={12} fontWeight={600} fill={ink.cream}>
          {label}
        </text>
      </g>
    </g>
  );
}

function Room({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="l-appear" style={vars({ "--d": "450ms" })}>
        <rect y={6} width={w} height={h} rx={28} fill="#000" opacity={0.18} />
        <rect width={w} height={h} rx={28} fill={ink.cream} />
        <text x={w / 2} y={30} textAnchor="middle" fontSize={14} fontWeight={600} fill={ink.spruce} className="font-display">
          Samarbeidsrom
        </text>
        <g transform={`translate(${w / 2 - 46} 40)`}>
          <rect width={92} height={18} rx={9} fill={ink.sage} />
          <text x={46} y={9} dy="0.35em" textAnchor="middle" fontSize={9} fontWeight={600} fill={ink.spruce}>
            Privat samarbeid
          </text>
        </g>
        <ellipse cx={w / 2} cy={h - 30} rx={w / 2 - 34} ry={14} fill={ink.sand} />
      </g>
    </g>
  );
}

/** A person walking into the room from one side. */
function Traveler({
  x,
  y,
  fromX = 0,
  fromY = 0,
  delay,
  shirt,
  skin,
  hair,
  style,
}: {
  x: number;
  y: number;
  fromX?: number;
  fromY?: number;
  delay: number;
  shirt: string;
  skin: number;
  hair: number;
  style: "short" | "bun" | "long" | "curly" | "cap";
}) {
  return (
    <At x={x} y={y} s={1.25}>
      <g
        className="l-travel"
        style={vars({ "--from-x": `${fromX}px`, "--from-y": `${fromY}px`, "--d": `${delay}ms` })}
      >
        <Person look={{ shirt, skin, hair, style }} />
      </g>
    </At>
  );
}

function Link({ d, delay }: { d: string; delay: number }) {
  return (
    <path
      d={d}
      pathLength={1}
      fill="none"
      stroke={ink.cream}
      strokeOpacity={0.7}
      strokeWidth={2}
      strokeLinecap="round"
      className="l-draw"
      style={vars({ "--d": `${delay}ms` })}
    />
  );
}

export function CollaborationDiagram() {
  const a = communities.kor;
  const b = communities.sykkel;
  const label =
    "Diagram: Kvitveis kor og Eik sykkelkollektiv har hver sine medlemmer. Noen få personer fra hver organisasjon møtes i et felles samarbeidsrom, mens medlemslistene forblir adskilt.";
  return (
    <>
      {/* Tablet and desktop: side by side */}
      <svg viewBox="0 0 960 400" className="hidden h-auto w-full font-sans sm:block" role="img" aria-label={label}>
        <g className="l-in-left">
          <Org cx={170} cy={200} r={140} community={a} ring={ink.lavender2} dotFill={ink.lavender2} dotLight={ink.lavender} labelY={346} />
        </g>
        <g className="l-in-right">
          <Org cx={790} cy={200} r={140} community={b} ring={ink.sky2} dotFill={ink.sky2} dotLight={ink.sky} labelY={346} />
        </g>
        <Link d="M312 200 C335 200 340 200 360 200" delay={700} />
        <Link d="M648 200 C625 200 620 200 600 200" delay={800} />
        <Room x={360} y={95} w={240} h={210} />
        <Traveler x={418} y={196} fromX={-250} delay={1050} shirt={ink.lavender2} skin={4} hair={2} style="long" />
        <Traveler x={460} y={206} fromX={-290} delay={1200} shirt={ink.lavender3} skin={2} hair={0} style="short" />
        <Traveler x={500} y={206} fromX={290} delay={1150} shirt={ink.sky3} skin={1} hair={3} style="curly" />
        <Traveler x={542} y={196} fromX={250} delay={1300} shirt={ink.sky2} skin={0} hair={1} style="bun" />
      </svg>

      {/* Phones: stacked */}
      <svg viewBox="0 0 360 720" className="h-auto w-full font-sans sm:hidden" role="img" aria-label={label}>
        <g className="l-in-left">
          <Org cx={180} cy={140} r={112} community={a} ring={ink.lavender2} dotFill={ink.lavender2} dotLight={ink.lavender} labelY={2} />
        </g>
        <g className="l-in-right">
          <Org cx={180} cy={580} r={112} community={b} ring={ink.sky2} dotFill={ink.sky2} dotLight={ink.sky} labelY={688} />
        </g>
        <Link d="M180 252 V280" delay={700} />
        <Link d="M180 468 V440" delay={800} />
        <Room x={60} y={280} w={240} h={160} />
        <Traveler x={110} y={350} fromY={-210} delay={1050} shirt={ink.lavender2} skin={4} hair={2} style="long" />
        <Traveler x={152} y={358} fromY={-220} delay={1200} shirt={ink.lavender3} skin={2} hair={0} style="short" />
        <Traveler x={208} y={358} fromY={220} delay={1150} shirt={ink.sky3} skin={1} hair={3} style="curly" />
        <Traveler x={250} y={350} fromY={210} delay={1300} shirt={ink.sky2} skin={0} hair={1} style="bun" />
      </svg>
    </>
  );
}
