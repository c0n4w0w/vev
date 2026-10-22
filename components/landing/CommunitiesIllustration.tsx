import { At, Mark, Person, communities, ink, vars } from "./art";

/**
 * One person, one account, several separate communities — each with its own
 * role. Lines draw out from the profile when the section scrolls into view.
 */

const cards = [
  { x: 18, y: 36, c: communities.kor, role: "Medlem", tone: "outline", dur: "7.2s" },
  { x: 326, y: 26, c: communities.sykkel, role: "Moderator", tone: "fjord", dur: "8.4s" },
  { x: 12, y: 340, c: communities.tur, role: "Administrator", tone: "skog", dur: "7.8s" },
  { x: 332, y: 350, c: communities.vel, role: "Medlem", tone: "outline", dur: "9s" },
] as const;

const badge = {
  outline: { fill: "transparent", stroke: ink.line2, text: ink.ink3 },
  fjord: { fill: "#e7eef2", stroke: "#cddce4", text: ink.sky3 },
  skog: { fill: "#e8efea", stroke: "#cfdfd5", text: ink.spruce },
} as const;

const links = [
  "M214 182 C190 150 166 128 150 104",
  "M306 181 C330 150 356 120 372 94",
  "M211 276 C190 300 166 320 150 340",
  "M309 276 C332 300 356 326 374 350",
];
const ends = [
  [150, 104],
  [372, 94],
  [150, 340],
  [374, 350],
];

export function CommunitiesIllustration() {
  return (
    <svg
      viewBox="0 0 520 420"
      className="h-auto w-full font-sans"
      role="img"
      aria-label="Illustrasjon: én profil i midten, koblet til fire separate fellesskap med ulik rolle i hvert."
    >
      <path
        d="M262 22 C392 14 506 92 510 214 C514 336 404 410 262 404 C120 398 10 330 10 208 C10 86 132 30 262 22Z"
        fill={ink.cream}
      />

      <g fill="none" stroke={ink.spruce} strokeWidth={1.6} strokeLinecap="round" strokeOpacity={0.5}>
        {links.map((d, i) => (
          <path key={d} d={d} pathLength={1} className="l-draw" style={vars({ "--d": `${250 + i * 140}ms` })} />
        ))}
      </g>
      {ends.map(([x, y], i) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
          <circle r={4} fill={ink.spruce} className="l-pop" style={vars({ "--d": `${900 + i * 140}ms` })} />
        </g>
      ))}

      {/* The person */}
      <g transform="translate(260 228)">
        <g className="l-pop" style={vars({ "--d": "100ms" })}>
          <circle r={70} fill={ink.sage} className="l-pulse" />
          <circle r={58} fill={ink.white} stroke={ink.line} />
          <clipPath id="l-profile-clip">
            <circle r={57} />
          </clipPath>
          <g clipPath="url(#l-profile-clip)">
            <At x={0} y={-12} s={2.3}>
              <Person look={{ shirt: ink.spruce2, skin: 1, hair: 1, style: "bun" }} />
            </At>
          </g>
        </g>
      </g>
      <g transform="translate(260 312)">
        <g className="l-pop" style={vars({ "--d": "300ms" })}>
          <rect x={-40} y={-13} width={80} height={26} rx={13} fill={ink.spruce} />
          <text y={0} dy="0.35em" textAnchor="middle" fontSize={11.5} fontWeight={600} fill={ink.cream}>
            Én konto
          </text>
        </g>
      </g>

      {cards.map((card, i) => {
        const b = badge[card.tone];
        const bw = card.role.length * 6.1 + 14;
        return (
          <g key={card.c.name} transform={`translate(${card.x} ${card.y})`}>
            <g className="l-appear" style={vars({ "--d": `${450 + i * 140}ms` })}>
              <g className="l-float" style={vars({ "--dur": card.dur, "--fd": `${i * 0.6}s` })}>
                <rect y={5} width={176} height={68} rx={14} fill={card.c.color} opacity={0.14} />
                <rect width={176} height={68} rx={14} fill={ink.white} stroke={ink.line} />
                <rect width={6} height={68} rx={3} fill={card.c.soft} />
                <Mark x={16} y={16} size={36} color={card.c.color} text={card.c.mono} />
                <text x={62} y={30} fontSize={12} fontWeight={600} fill={ink.ink}>
                  {card.c.name}
                </text>
                <rect x={62} y={38} width={bw} height={17} rx={4} fill={b.fill} stroke={b.stroke} />
                <text x={62 + bw / 2} y={46.5} dy="0.35em" textAnchor="middle" fontSize={9.5} fontWeight={500} fill={b.text}>
                  {card.role}
                </text>
              </g>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
