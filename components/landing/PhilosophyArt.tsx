import { At, Lines, Mark, Person, communities, ink, vars, type PersonLook } from "./art";

/**
 * Illustrations for why TING exists: the attention economy next to
 * community spaces, money flowing back into the platform, development shaped
 * by the people using it, and the four founding principles.
 */

// ── Attention funnel vs. gathering circles ───────────────────────────────

const fallers = [
  // Negative delays start each person mid-fall, so none pops in late.
  { x: 120, d: "0s" },
  { x: 168, d: "-1.1s" },
  { x: 214, d: "-0.4s" },
  { x: 262, d: "-1.6s" },
  { x: 310, d: "-0.8s" },
  { x: 146, d: "-2.1s" },
  { x: 288, d: "-2.6s" },
];
const mutedHeads = ["#c9bfae", "#b8ad9a", "#a99e8b", "#d3cab9"];

/** People pulled into a funnel of feeds and ads; what comes out is revenue. */
export function AttentionArt() {
  return (
    <svg viewBox="0 0 440 360" className="block h-auto w-full font-sans" aria-hidden="true">
      <rect width={440} height={360} fill="#ebe6dd" />
      {/* Notification noise */}
      <g transform="translate(372 42)">
        <circle r={17} fill={ink.peach3} opacity={0.85} />
        <text dy="0.35em" textAnchor="middle" fontSize={11} fontWeight={700} fill={ink.white}>
          99+
        </text>
      </g>
      {/* People drifting into the funnel */}
      {fallers.map((f, i) => (
        <g key={f.x} transform={`translate(${f.x} ${30 + (i % 2) * 14})`}>
          <g className="l-drop" style={vars({ "--fd": f.d })}>
            <circle r={8} fill={mutedHeads[i % mutedHeads.length]} />
            <path d="M-11 22 C-11 14 -6 11 0 11 C6 11 11 14 11 22Z" fill={mutedHeads[(i + 1) % mutedHeads.length]} />
          </g>
        </g>
      ))}
      {/* The funnel, lined with feeds and ads */}
      <path d="M70 92 H370 L252 222 V268 H188 V222Z" fill="#d7cfc1" />
      <path d="M70 92 H370 L360 104 H80Z" fill="#c8bfae" />
      <g transform="translate(108 112) rotate(-8)">
        <rect width={64} height={22} rx={4} fill="#f4ece2" stroke={ink.peach3} strokeDasharray="3 3" />
        <text x={32} y={11} dy="0.35em" textAnchor="middle" fontSize={8.5} fontWeight={700} letterSpacing="0.1em" fill={ink.peach3}>
          ANNONSE
        </text>
      </g>
      <g transform="translate(262 116) rotate(7)">
        <rect width={64} height={22} rx={4} fill="#f4ece2" stroke={ink.peach3} strokeDasharray="3 3" />
        <text x={32} y={11} dy="0.35em" textAnchor="middle" fontSize={8.5} fontWeight={700} letterSpacing="0.1em" fill={ink.peach3}>
          ANNONSE
        </text>
      </g>
      {/* An endless feed in the throat */}
      <rect x={196} y={150} width={48} height={70} rx={6} fill="#f4ece2" />
      <Lines x={202} y={158} widths={[36, 26, 36, 22, 36, 30]} gap={10} h={4} color="#d7cfc1" />
      <path d="M220 228 v8 M214 232 l6 6 6 -6" stroke="#8f8572" strokeWidth={2} fill="none" strokeLinecap="round" />
      {/* Revenue piling up somewhere else */}
      {[0, 1, 2, 3, 4].map((i) => (
        <ellipse key={i} cx={220} cy={326 - i * 9} rx={30} ry={8} fill={i % 2 ? "#c9a75e" : "#d9b86e"} stroke="#b08d48" strokeWidth={1} />
      ))}
    </svg>
  );
}

const ringPeople: { x: number; y: number; look: PersonLook }[][] = [
  [
    { x: -26, y: -14, look: { shirt: ink.lavender2, skin: 1, hair: 2, style: "long" } },
    { x: 24, y: -18, look: { shirt: ink.lavender3, skin: 3, hair: 0, style: "short" } },
    { x: 0, y: 22, look: { shirt: ink.peach2, skin: 0, hair: 1, style: "bun" } },
  ],
  [
    { x: -24, y: -16, look: { shirt: ink.sky3, skin: 2, hair: 3, style: "curly" } },
    { x: 26, y: -10, look: { shirt: ink.sky2, skin: 4, hair: 4, style: "cap" } },
    { x: 0, y: 24, look: { shirt: ink.sage3, skin: 5, hair: 0, style: "short" } },
  ],
  [
    { x: -22, y: -12, look: { shirt: ink.peach3, skin: 0, hair: 5, style: "short" } },
    { x: 24, y: -16, look: { shirt: ink.spruce2, skin: 2, hair: 2, style: "long" } },
  ],
];

/** Separate communities, each inside its own boundary, side by side. */
export function CirclesArt() {
  const rings = [
    { cx: 120, cy: 150, r: 74, c: communities.kor, stroke: ink.lavender2, fill: ink.lavender },
    { cx: 316, cy: 150, r: 74, c: communities.sykkel, stroke: ink.sky2, fill: ink.sky },
    { cx: 218, cy: 272, r: 62, c: communities.vel, stroke: ink.peach2, fill: ink.peach },
  ];
  return (
    <svg viewBox="0 0 440 360" className="block h-auto w-full font-sans" aria-hidden="true">
      <rect width={440} height={360} fill="#e3eee6" />
      <circle cx={220} cy={190} r={168} fill="#d6e7da" />
      {/* Light ties between neighbours, without merging them */}
      <g stroke={ink.spruce} strokeOpacity={0.35} strokeWidth={1.6} strokeLinecap="round" fill="none">
        <path d="M194 150 H242" pathLength={1} className="l-draw" style={vars({ "--d": "500ms" })} />
        <path d="M162 214 L184 234" pathLength={1} className="l-draw" style={vars({ "--d": "650ms" })} />
        <path d="M274 214 L252 234" pathLength={1} className="l-draw" style={vars({ "--d": "800ms" })} />
      </g>
      {rings.map((ring, i) => (
        <g key={ring.c.mono}>
          <circle cx={ring.cx} cy={ring.cy} r={ring.r} fill={ring.fill} />
          <circle
            cx={ring.cx}
            cy={ring.cy}
            r={ring.r}
            fill="none"
            stroke={ring.stroke}
            strokeWidth={2}
            strokeDasharray="3 6"
            strokeLinecap="round"
          />
          <Mark x={ring.cx - 12} y={ring.cy - ring.r - 12} size={24} color={ring.c.color} text={ring.c.mono} />
          {ringPeople[i].map((p, j) => (
            <At key={j} x={ring.cx + p.x} y={ring.cy + p.y - 10} s={0.95}>
              <g className="l-pop" style={vars({ "--d": `${200 + i * 150 + j * 80}ms` })}>
                <Person look={p.look} />
              </g>
            </At>
          ))}
        </g>
      ))}
    </svg>
  );
}

// ── Money flows back ─────────────────────────────────────────────────────

const stations = [
  { x: 280, y: 92, label: "Inntekter" },
  { x: 452, y: 262, label: "Drift" },
  { x: 280, y: 432, label: "Videreutvikling" },
  { x: 108, y: 262, label: "Bedre plattform" },
];

function StationIcon({ i }: { i: number }) {
  if (i === 0)
    return (
      <g>
        <circle r={11} fill="#e3be6f" stroke="#b08d48" />
        <circle r={6.5} fill="none" stroke="#b08d48" />
      </g>
    );
  if (i === 1)
    return (
      <g>
        <rect x={-11} y={-11} width={22} height={9} rx={2.5} fill={ink.sky3} />
        <rect x={-11} y={2} width={22} height={9} rx={2.5} fill={ink.sky3} />
        <circle cx={6} cy={-6.5} r={1.6} fill={ink.sky} />
        <circle cx={6} cy={6.5} r={1.6} fill={ink.sky} />
      </g>
    );
  if (i === 2)
    return (
      <g>
        <rect x={-12} y={0} width={11} height={11} rx={2} fill={ink.lavender2} />
        <rect x={1} y={0} width={11} height={11} rx={2} fill={ink.lavender3} />
        <rect x={-5.5} y={-12} width={11} height={11} rx={2} fill={ink.peach2} />
      </g>
    );
  return (
    <g>
      <rect x={-12} y={-10} width={24} height={20} rx={4} fill={ink.white} stroke={ink.spruce} strokeWidth={1.5} />
      <path d="M-5 0 l3.5 3.5 L6 -4" stroke={ink.spruce} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/** A closed loop around the communities, with the exit to owners shut. */
export function ReinvestArt() {
  const R = 170;
  return (
    <svg
      viewBox="0 0 560 520"
      className="block h-auto w-full font-sans"
      role="img"
      aria-label="Illustrasjon: en sirkel rundt fellesskapene. Inntekter går til drift, videreutvikling og en bedre plattform, og tilbake til fellesskapene. Veien til utbytte for eiere er stengt."
    >
      <circle cx={280} cy={262} r={R + 40} fill={ink.cream} />
      {/* The closed exit */}
      <g opacity={0.9}>
        <path d="M402 144 L468 74" stroke={ink.ink3} strokeWidth={1.6} strokeDasharray="4 5" strokeLinecap="round" />
        <g transform="translate(468 50)">
          <rect x={-74} y={-20} width={148} height={40} rx={20} fill={ink.white} stroke={ink.line2} />
          <text dy="0.35em" textAnchor="middle" fontSize={14} fontWeight={500} fill={ink.ink3}>
            Utbytte til eiere
          </text>
          <line x1={-58} x2={58} y1={0} y2={0} stroke={ink.peach3} strokeWidth={2.2} strokeLinecap="round" />
        </g>
        <g transform="translate(435 109)">
          <circle r={10} fill={ink.peach3} />
          <path d="M-4 -4 L4 4 M4 -4 L-4 4" stroke={ink.white} strokeWidth={2} strokeLinecap="round" />
        </g>
      </g>

      {/* The loop */}
      <circle cx={280} cy={262} r={R} fill="none" stroke={ink.sage2} strokeWidth={16} strokeOpacity={0.5} />
      <circle
        cx={280}
        cy={262}
        r={R}
        fill="none"
        stroke={ink.spruce}
        strokeWidth={2}
        strokeLinecap="round"
        pathLength={1}
        className="l-draw"
        style={vars({ "--d": "200ms" })}
        transform="rotate(-90 280 262)"
      />
      {/* Direction: chevrons between stations, clockwise */}
      {[45, 135, 225, 315].map((deg) => {
        const a = ((deg - 90) * Math.PI) / 180;
        const x = 280 + R * Math.cos(a);
        const y = 262 + R * Math.sin(a);
        return (
          <g key={deg} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg})`}>
            <path d="M-5 -7 L4 0 L-5 7" stroke={ink.spruce} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      })}
      {/* A coin travelling around */}
      <g transform="translate(280 262)">
        <g className="l-orbit">
          <circle r={R} fill="none" />
          <g transform={`translate(0 ${-R})`}>
            <circle r={8} fill="#e3be6f" stroke="#b08d48" />
          </g>
        </g>
      </g>

      {/* The communities at the centre */}
      <circle cx={280} cy={262} r={102} fill={ink.sage} />
      {[
        { x: 236, y: 236, look: { shirt: ink.lavender2, skin: 1, hair: 2, style: "long" } },
        { x: 280, y: 222, look: { shirt: ink.spruce2, skin: 3, hair: 0, style: "short" } },
        { x: 324, y: 236, look: { shirt: ink.sky3, skin: 0, hair: 3, style: "curly" } },
        { x: 258, y: 270, look: { shirt: ink.peach2, skin: 4, hair: 1, style: "bun" } },
        { x: 302, y: 270, look: { shirt: ink.peach3, skin: 2, hair: 5, style: "cap" } },
      ].map((p, i) => (
        <At key={i} x={p.x} y={p.y} s={1.05}>
          <Person look={p.look as PersonLook} />
        </At>
      ))}
      <text x={280} y={334} textAnchor="middle" fontSize={14} fill={ink.spruce} className="font-display">
        Fellesskapene
      </text>

      {stations.map((s, i) => {
        const w = s.label.length * 7.3 + 52;
        return (
          <g key={s.label} transform={`translate(${s.x} ${s.y})`}>
            <g className="l-pop" style={vars({ "--d": `${500 + i * 160}ms` })}>
              <rect x={-w / 2} y={-21} width={w} height={42} rx={21} fill={ink.white} stroke={ink.line} />
              <g transform={`translate(${-w / 2 + 22} 0)`}>
                <StationIcon i={i} />
              </g>
              <text x={-w / 2 + 40} y={0} dy="0.35em" fontSize={13} fontWeight={600} fill={ink.ink}>
                {s.label}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

// ── Shaped by the people using it ────────────────────────────────────────

/** Five stations around a loop with the platform in the middle. */
export function FeedbackLoopArt() {
  const pts = [
    { x: 174, y: 96 },
    { x: 426, y: 96 },
    { x: 512, y: 256 },
    { x: 300, y: 366 },
    { x: 88, y: 256 },
  ];
  const tints = [ink.sage, ink.peach, ink.lavender, ink.sky, "#f4ece2"];
  return (
    <svg
      viewBox="0 0 600 430"
      className="block h-auto w-full font-sans"
      role="img"
      aria-label="Illustrasjon: en sløyfe med fem steg rundt TING – menneskene som bruker plattformen, ideer, utvikling, forbedringer og tilbakemeldinger som fører tilbake til menneskene."
    >
      <ellipse cx={300} cy={226} rx={222} ry={150} fill="none" stroke={ink.spruce} strokeOpacity={0.18} strokeWidth={14} />
      <ellipse
        cx={300}
        cy={226}
        rx={222}
        ry={150}
        fill="none"
        stroke={ink.spruce}
        strokeWidth={2}
        pathLength={1}
        className="l-draw"
        style={vars({ "--d": "150ms" })}
      />
      <g transform="translate(300 226)">
        <rect x={-92} y={-38} width={184} height={76} rx={22} fill={ink.cream} stroke={ink.line} />
        {/* The official lockup, used as is */}
        <image href="/brand/ting-horizontal-spruce-trim.svg" x={-60} y={-15} width={120} height={30} />
      </g>

      {pts.map((p, i) => (
        <g key={i} transform={`translate(${p.x} ${p.y})`}>
          <g className="l-pop" style={vars({ "--d": `${400 + i * 180}ms` })}>
            <circle r={50} fill={tints[i]} stroke={ink.white} strokeWidth={4} />
            {i === 0 ? (
              <>
                <At x={-15} y={-12} s={0.95}>
                  <Person look={{ shirt: ink.sage3, skin: 1, hair: 0, style: "short" }} />
                </At>
                <At x={15} y={-8} s={0.95}>
                  <Person look={{ shirt: ink.lavender2, skin: 4, hair: 2, style: "long" }} />
                </At>
              </>
            ) : null}
            {i === 1 ? (
              <g>
                <path d="M-26 -8 C-26 -20 -16 -26 0 -26 C16 -26 26 -20 26 -8 C26 4 16 10 2 10 L-10 20 L-8 8 C-20 6 -26 1 -26 -8Z" fill={ink.white} />
                <circle cx={0} cy={-12} r={7} fill="#e3be6f" />
                <rect x={-3.5} y={-5} width={7} height={5} rx={1} fill="#b08d48" />
              </g>
            ) : null}
            {i === 2 ? (
              <g>
                <rect x={-22} y={2} width={20} height={18} rx={3} fill={ink.lavender2} />
                <rect x={2} y={2} width={20} height={18} rx={3} fill={ink.lavender3} />
                <rect x={-10} y={-18} width={20} height={18} rx={3} fill={ink.peach2} />
                <text y={-9} dy="0.35em" textAnchor="middle" fontSize={9} fontWeight={700} fill={ink.white}>
                  {"</>"}
                </text>
              </g>
            ) : null}
            {i === 3 ? (
              <g>
                <rect x={-26} y={-20} width={52} height={40} rx={7} fill={ink.white} />
                <rect x={-19} y={-12} width={26} height={5} rx={2.5} fill={ink.line2} />
                <rect x={-19} y={-2} width={34} height={5} rx={2.5} fill={ink.line2} />
                <rect x={-19} y={8} width={20} height={7} rx={3.5} fill={ink.spruce} />
                <g transform="translate(20 -18)">
                  <circle r={9} fill={ink.spruce} />
                  <path d="M-4 0 l3 3 l5 -6" stroke={ink.white} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              </g>
            ) : null}
            {i === 4 ? (
              <g>
                <path d="M-24 -6 C-24 -18 -14 -22 0 -22 C14 -22 24 -18 24 -6 C24 6 14 10 0 10 L-12 18 L-10 8 C-19 5 -24 1 -24 -6Z" fill={ink.white} />
                <path d="M0 2 C-7 -3 -9 -6 -9 -9 C-9 -11.5 -7 -13.5 -4.6 -13.5 C-2.4 -13.5 -1 -12.2 0 -10.8 C1 -12.2 2.4 -13.5 4.6 -13.5 C7 -13.5 9 -11.5 9 -9 C9 -6 7 -3 0 2Z" fill={ink.peach3} />
              </g>
            ) : null}
            <g transform="translate(34 -36)">
              <circle r={13} fill={ink.spruce} />
              <text dy="0.35em" textAnchor="middle" fontSize={12} fontWeight={700} fill={ink.cream}>
                {i + 1}
              </text>
            </g>
          </g>
        </g>
      ))}
    </svg>
  );
}

// ── Principle cards ──────────────────────────────────────────────────────

/** Contributors stacking see-through building blocks. */
export function OpenSourceArt() {
  return (
    <svg viewBox="0 0 320 200" className="block h-auto w-full font-sans" aria-hidden="true">
      <circle cx={70} cy={60} r={52} fill="#eaf1f5" />
      <g opacity={0.9}>
        <rect x={98} y={118} width={124} height={50} rx={10} fill={ink.sky2} fillOpacity={0.55} stroke={ink.sky3} strokeOpacity={0.5} />
        <rect x={110} y={82} width={100} height={44} rx={10} fill={ink.lavender2} fillOpacity={0.55} stroke={ink.lavender3} strokeOpacity={0.5} />
        <g transform="translate(160 64)">
          <g className="l-float" style={vars({ "--dur": "5.5s" })}>
            <rect x={-38} y={-20} width={76} height={40} rx={10} fill={ink.white} fillOpacity={0.85} stroke={ink.sky3} strokeOpacity={0.6} />
            <text dy="0.35em" textAnchor="middle" fontSize={15} fontWeight={700} fill={ink.sky3}>
              {"</>"}
            </text>
          </g>
        </g>
      </g>
      <At x={60} y={128} s={1.05}>
        <Person look={{ shirt: ink.sky3, skin: 2, hair: 3, style: "curly" }} />
      </At>
      <rect x={74} y={140} width={18} height={18} rx={4} fill={ink.peach2} fillOpacity={0.8} />
      <At x={262} y={120} s={1.05}>
        <Person look={{ shirt: ink.lavender3, skin: 0, hair: 1, style: "bun" }} />
      </At>
      <rect x={228} y={132} width={18} height={18} rx={4} fill={ink.sage2} fillOpacity={0.9} />
    </svg>
  );
}

/** Money circling back into the community instead of out of it. */
export function NoProfitArt() {
  return (
    <svg viewBox="0 0 320 200" className="block h-auto w-full font-sans" aria-hidden="true">
      <circle cx={262} cy={52} r={50} fill="#fbeadd" />
      <circle cx={160} cy={104} r={70} fill="none" stroke={ink.peach2} strokeWidth={10} strokeOpacity={0.45} />
      <path d="M160 34 A70 70 0 1 1 92 88" fill="none" stroke={ink.peach3} strokeWidth={2.4} strokeLinecap="round" />
      <path d="M86 78 L92 90 L102 81" fill="none" stroke={ink.peach3} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      <g transform="translate(160 104)">
        <g className="l-orbit l-orbit-slow">
          <circle r={70} fill="none" />
          <g transform="translate(70 0)">
            <circle r={9} fill="#e3be6f" stroke="#b08d48" />
          </g>
        </g>
      </g>
      <At x={140} y={92} s={1}>
        <Person look={{ shirt: ink.peach3, skin: 4, hair: 2, style: "long" }} />
      </At>
      <At x={180} y={92} s={1}>
        <Person look={{ shirt: ink.spruce2, skin: 1, hair: 0, style: "short" }} />
      </At>
      <At x={160} y={110} s={1}>
        <Person look={{ shirt: ink.sky3, skin: 2, hair: 3, style: "curly" }} />
      </At>
    </svg>
  );
}

/** Ideas from members turning into something new in the product. */
export function ShapedArt() {
  return (
    <svg viewBox="0 0 320 200" className="block h-auto w-full font-sans" aria-hidden="true">
      <circle cx={58} cy={150} r={52} fill="#efebf6" />
      <At x={56} y={110} s={1.1}>
        <Person look={{ shirt: ink.lavender2, skin: 3, hair: 4, style: "short" }} />
      </At>
      <g transform="translate(40 40)">
        <g className="l-float" style={vars({ "--dur": "6s" })}>
          <path d="M0 14 C0 5 6 0 16 0 H48 C58 0 64 5 64 14 C64 23 58 28 48 28 H18 L8 36 L10 27 C3 25 0 20 0 14Z" fill={ink.white} />
          <circle cx={32} cy={12} r={6} fill="#e3be6f" />
          <rect x={29} y={18} width={6} height={4} rx={1} fill="#b08d48" />
        </g>
      </g>
      <path d="M110 70 C140 70 150 96 176 96" fill="none" stroke={ink.lavender3} strokeWidth={1.8} strokeDasharray="3 5" strokeLinecap="round" />
      <rect x={176} y={40} width={120} height={126} rx={14} fill={ink.white} stroke="#d8d0e8" />
      <Lines x={190} y={58} widths={[70, 52]} gap={12} h={6} />
      <rect x={188} y={90} width={96} height={30} rx={8} fill={ink.lavender} />
      <rect x={198} y={101} width={52} height={7} rx={3.5} fill={ink.lavender3} opacity={0.6} />
      <g transform="translate(278 90)">
        <rect x={-22} y={-9} width={34} height={18} rx={9} fill={ink.lavender3} />
        <text x={-5} dy="0.35em" textAnchor="middle" fontSize={8.5} fontWeight={700} fill={ink.white}>
          Nytt
        </text>
      </g>
      <Lines x={190} y={134} widths={[80, 60]} gap={12} h={6} />
    </svg>
  );
}

/** A plain timeline: newest first, no ranking. */
export function ChronoArt() {
  const posts = [
    { t: "Nå", w: 92, c: ink.sage },
    { t: "1 t", w: 70, c: ink.lavender },
    { t: "I går", w: 84, c: ink.peach },
  ];
  return (
    <svg viewBox="0 0 320 200" className="block h-auto w-full font-sans" aria-hidden="true">
      <circle cx={266} cy={150} r={56} fill="#e9f1ea" />
      <line x1={86} x2={86} y1={34} y2={176} stroke={ink.sage2} strokeWidth={2} />
      {posts.map((p, i) => (
        <g key={p.t} transform={`translate(0 ${40 + i * 48})`}>
          <circle cx={86} cy={14} r={6} fill={i === 0 ? ink.spruce : ink.white} stroke={ink.spruce} strokeWidth={2} />
          <text x={70} y={14} dy="0.35em" textAnchor="end" fontSize={10.5} fill={ink.ink3}>
            {p.t}
          </text>
          <rect x={102} y={0} width={150} height={30} rx={9} fill={ink.white} stroke={ink.line} />
          <circle cx={118} cy={15} r={7} fill={p.c} />
          <rect x={132} y={12} width={p.w} height={6} rx={3} fill={ink.line2} />
        </g>
      ))}
      <g transform="translate(268 44)">
        <circle r={20} fill={ink.white} stroke={ink.spruce} strokeWidth={2} />
        <path d="M0 -11 V0 L8 5" stroke={ink.spruce} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
