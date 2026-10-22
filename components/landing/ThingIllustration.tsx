import { At, Mark, Person, communities, ink, vars, type PersonLook } from "./art";

/**
 * "Then" and "now": the same circle of people, first gathered among standing
 * stones at a þing, then around a shared conversation in a digital space.
 * Placement is identical in both panels so the eye reads one as the other.
 */

const ring = [
  { x: 92, y: 176 },
  { x: 150, y: 150 },
  { x: 220, y: 142 },
  { x: 290, y: 150 },
  { x: 348, y: 176 },
];

const thenLooks: PersonLook[] = [
  { shirt: ink.sand2, skin: 0, hair: 2, style: "long" },
  { shirt: "#7c6a4f", skin: 1, hair: 5, style: "short" },
  { shirt: ink.peach3, skin: 4, hair: 4, style: "long" },
  { shirt: ink.sage3, skin: 2, hair: 0, style: "short" },
  { shirt: "#8a7356", skin: 5, hair: 1, style: "bun" },
];

const nowLooks: PersonLook[] = [
  { shirt: ink.lavender2, skin: 3, hair: 3, style: "curly" },
  { shirt: ink.sky3, skin: 1, hair: 0, style: "cap" },
  { shirt: ink.peach2, skin: 4, hair: 2, style: "long" },
  { shirt: ink.spruce2, skin: 2, hair: 1, style: "bun" },
  { shirt: ink.sky2, skin: 0, hair: 4, style: "short" },
];

const stones = [
  [60, 214, 22, 40],
  [118, 196, 18, 34],
  [186, 188, 16, 30],
  [256, 188, 16, 30],
  [322, 196, 18, 34],
  [378, 214, 22, 40],
];

export function ThenArt() {
  return (
    <svg viewBox="0 0 440 280" className="h-auto w-full font-sans" aria-hidden="true">
      <rect width={440} height={280} fill="#efe6d3" />
      <circle cx={340} cy={70} r={34} fill={ink.peach} />
      <path d="M0 150 C80 110 150 128 220 116 C300 104 360 120 440 100 V280 H0Z" fill="#dfd2b8" />
      <path d="M0 196 C110 176 330 176 440 196 V280 H0Z" fill="#cbbf9f" />
      {/* A lone tree on the hill */}
      <rect x={398} y={88} width={5} height={30} fill="#7c6a4f" />
      <circle cx={400} cy={80} r={16} fill={ink.sage3} />
      <ellipse cx={220} cy={226} rx={170} ry={34} fill="#bfb18f" />
      {ring.map((p, i) => (
        <At key={i} x={p.x} y={p.y} s={1.25}>
          <Person look={thenLooks[i]} />
        </At>
      ))}
      {stones.map(([x, y, w, h], i) => (
        <rect key={i} x={x - w / 2} y={y} width={w} height={h} rx={w / 2.4} fill="#8f8572" />
      ))}
      {/* The speaker's staff */}
      <line x1={232} y1={104} x2={238} y2={188} stroke="#5a4632" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

export function NowArt() {
  const marks = [communities.kor, communities.tur, communities.vel, communities.sykkel];
  return (
    <svg viewBox="0 0 440 280" className="h-auto w-full font-sans" aria-hidden="true">
      <rect width={440} height={280} fill="#e3eee6" />
      <circle cx={340} cy={70} r={34} fill={ink.sky} />
      <path d="M0 150 C80 110 150 128 220 116 C300 104 360 120 440 100 V280 H0Z" fill="#cfe2d4" />
      <path d="M0 196 C110 176 330 176 440 196 V280 H0Z" fill="#b7d1bf" />
      <ellipse cx={220} cy={226} rx={170} ry={34} fill={ink.sage2} />
      {ring.map((p, i) => (
        <At key={i} x={p.x} y={p.y} s={1.25}>
          <Person look={nowLooks[i]} />
        </At>
      ))}
      {/* Stones become small screens */}
      {stones.map(([x, y, w, h], i) => (
        <g key={i}>
          <rect x={x - w / 2} y={y} width={w} height={h} rx={5} fill={ink.white} stroke={ink.spruce} strokeOpacity={0.35} />
          <rect x={x - w / 2 + 4} y={y + 6} width={w - 8} height={3} rx={1.5} fill={ink.line2} />
          <rect x={x - w / 2 + 4} y={y + 12} width={(w - 8) * 0.7} height={3} rx={1.5} fill={ink.line2} />
        </g>
      ))}
      {/* Conversation rising from the circle */}
      {[
        { x: 120, y: 66, w: 64, c: ink.lavender, d: "0s" },
        { x: 196, y: 40, w: 56, c: ink.white, d: "1.2s" },
        { x: 270, y: 70, w: 70, c: ink.peach, d: "0.6s" },
      ].map((b) => (
        <g key={b.x} transform={`translate(${b.x} ${b.y})`}>
          <g className="l-float" style={vars({ "--dur": "6.5s", "--fd": b.d })}>
            <rect width={b.w} height={24} rx={12} fill={b.c} />
            <rect x={10} y={10} width={b.w - 20} height={4} rx={2} fill={ink.spruce} opacity={0.25} />
          </g>
        </g>
      ))}
      <g transform="translate(206 92)">
        {marks.map((m, i) => (
          <Mark key={m.mono} x={(i % 2) * 15 - 7} y={Math.floor(i / 2) * 15} size={13} color={m.color} text="" />
        ))}
      </g>
    </svg>
  );
}
