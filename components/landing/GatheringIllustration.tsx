import { At, Person, communities, ink, vars, type PersonLook } from "./art";

/**
 * Closing scene: a lively community on a hill, with small pennants for the
 * groups they belong to. On phones the scene is cropped around its centre
 * instead of shrinking, so the people stay a readable size.
 */

const crowd: { x: number; y: number; s: number; look: PersonLook }[] = [
  { x: 150, y: 168, s: 1.5, look: { shirt: ink.sage3, skin: 1, hair: 0, style: "short" } },
  { x: 210, y: 160, s: 1.7, look: { shirt: ink.peach2, skin: 4, hair: 2, style: "long" } },
  { x: 276, y: 170, s: 1.5, look: { shirt: ink.sky3, skin: 3, hair: 3, style: "curly" } },
  { x: 336, y: 150, s: 1.8, look: { shirt: ink.lavender2, skin: 0, hair: 1, style: "bun" } },
  { x: 404, y: 162, s: 1.6, look: { shirt: ink.spruce, skin: 2, hair: 5, style: "short" } },
  { x: 470, y: 146, s: 1.9, look: { shirt: ink.peach3, skin: 5, hair: 4, style: "cap" } },
  { x: 540, y: 158, s: 1.7, look: { shirt: ink.sky2, skin: 0, hair: 2, style: "long" } },
  { x: 606, y: 150, s: 1.8, look: { shirt: ink.sage2, skin: 3, hair: 0, style: "curly" } },
  { x: 672, y: 164, s: 1.6, look: { shirt: ink.lavender3, skin: 1, hair: 3, style: "short" } },
  { x: 736, y: 160, s: 1.5, look: { shirt: ink.peach2, skin: 4, hair: 1, style: "bun" } },
  { x: 800, y: 172, s: 1.4, look: { shirt: ink.sky3, skin: 2, hair: 4, style: "short" } },
];

const pennants = [
  { x: 112, top: 70, c: communities.tur },
  { x: 372, top: 46, c: communities.kor },
  { x: 640, top: 52, c: communities.sykkel },
  { x: 846, top: 80, c: communities.vel },
];

export function GatheringIllustration() {
  return (
    <svg
      viewBox="0 0 960 260"
      preserveAspectRatio="xMidYMax slice"
      className="block h-48 w-full font-sans sm:h-auto"
      aria-hidden="true"
    >
      <path d="M0 200 C160 172 320 186 480 178 C640 170 800 176 960 200 V260 H0Z" fill={ink.sage} />
      <path d="M0 236 C220 214 740 214 960 236 V260 H0Z" fill={ink.sage2} opacity={0.6} />
      {pennants.map((p, i) => (
        <g key={p.x}>
          <line x1={p.x} x2={p.x} y1={p.top} y2={206} stroke={ink.spruce} strokeOpacity={0.5} strokeWidth={2} />
          <g transform={`translate(${p.x} ${p.top})`}>
            <g className="l-float" style={vars({ "--dur": `${6 + i}s`, "--fd": `${i * 0.5}s` })}>
              <path d="M0 0 H46 L36 15 L46 30 H0Z" fill={p.c.color} />
              <text x={18} y={15} dy="0.35em" textAnchor="middle" fontSize={11} fontWeight={600} fill="#fff" className="font-display">
                {p.c.mono}
              </text>
            </g>
          </g>
        </g>
      ))}
      {crowd.map((p, i) => (
        <At key={i} x={p.x} y={p.y} s={p.s}>
          <Person look={p.look} />
        </At>
      ))}
      {[
        { x: 238, y: 104, c: ink.white, d: "0s" },
        { x: 498, y: 82, c: ink.peach, d: "1s" },
        { x: 700, y: 100, c: ink.lavender, d: "0.5s" },
      ].map((b) => (
        <g key={b.x} transform={`translate(${b.x} ${b.y})`}>
          <g className="l-float" style={vars({ "--dur": "7s", "--fd": b.d })}>
            <path d="M0 11 C0 5 4 0 11 0 H39 C46 0 50 5 50 11 C50 17 46 22 39 22 H14 L5 29 L7 21 C2 19 0 15 0 11Z" fill={b.c} />
            <circle cx={16} cy={11} r={2.4} fill={ink.spruce} opacity={0.5} />
            <circle cx={25} cy={11} r={2.4} fill={ink.spruce} opacity={0.5} />
            <circle cx={34} cy={11} r={2.4} fill={ink.spruce} opacity={0.5} />
          </g>
        </g>
      ))}
    </svg>
  );
}
