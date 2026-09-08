import type { SVGProps } from "react";

/**
 * One consistent icon set: 24px grid, 1.5px strokes, round caps. Kept inline so
 * the prototype ships no icon dependency and every glyph matches the others.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconHome = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 10.4 12 3.8l8.5 6.6V20a.8.8 0 0 1-.8.8h-4.4v-6.2H8.7v6.2H4.3a.8.8 0 0 1-.8-.8Z" />
  </Svg>
);

export const IconCommunities = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.2" y="3.2" width="7.6" height="7.6" rx="1.4" />
    <rect x="13.2" y="3.2" width="7.6" height="7.6" rx="1.4" />
    <rect x="3.2" y="13.2" width="7.6" height="7.6" rx="1.4" />
    <rect x="13.2" y="13.2" width="7.6" height="7.6" rx="1.4" />
  </Svg>
);

export const IconCalendar = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.2" y="5" width="17.6" height="15.8" rx="1.6" />
    <path d="M3.2 9.6h17.6M8 3.2v3.6M16 3.2v3.6" />
  </Svg>
);

export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 10a6 6 0 0 1 12 0c0 3.2.7 5 1.6 6.1H4.4C5.3 15 6 13.2 6 10Z" />
    <path d="M9.6 19.4a2.6 2.6 0 0 0 4.8 0" />
  </Svg>
);

export const IconUser = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8.2" r="3.8" />
    <path d="M4.6 20.4c.7-3.7 3.8-6 7.4-6s6.7 2.3 7.4 6" />
  </Svg>
);

export const IconUsers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9.4" cy="8.6" r="3.4" />
    <path d="M3 19.8c.6-3.2 3.3-5.4 6.4-5.4s5.8 2.2 6.4 5.4" />
    <path d="M16 5.6a3.4 3.4 0 0 1 0 6.6M17.4 14.9c2 .7 3.4 2.5 3.8 4.9" />
  </Svg>
);

export const IconHash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 9.2h14M5 14.8h14M10.2 4l-1.6 16M15.4 4l-1.6 16" />
  </Svg>
);

export const IconFeed = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.2" y="4.2" width="17.6" height="15.6" rx="1.6" />
    <path d="M7 8.6h6M7 12.4h10M7 15.8h7.4" />
  </Svg>
);

export const IconMegaphone = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10.2v3.6a1.6 1.6 0 0 0 1.6 1.6h2L14.8 19V5L7.6 8.6h-2A1.6 1.6 0 0 0 4 10.2Z" />
    <path d="M18 9.2a4 4 0 0 1 0 5.6M7.8 15.6l1.2 4.6" />
  </Svg>
);

export const IconOverview = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20.2V9.4l8-5.6 8 5.6v10.8" />
    <path d="M4 20.2h16M9.6 20.2v-5.6h4.8v5.6" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 9.5 12 15l5.5-5.5" />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </Svg>
);

export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5M11 5.5 4.5 12l6.5 6.5" />
  </Svg>
);

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 5.5 19.5 12 13 18.5" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.8 12.6 9.6 17.4 19.2 6.6" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.6" y="10.4" width="14.8" height="10" rx="1.8" />
    <path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6" />
  </Svg>
);

export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const IconSend = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 4 3.8 10.6l6.6 2.6M20 4l-2.6 16-7-6.8M20 4 10.4 13.2" />
  </Svg>
);

export const IconAttach = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18.6 11.2 12 17.8a4.1 4.1 0 0 1-5.8-5.8l7.4-7.4a2.8 2.8 0 0 1 4 4l-7.4 7.4a1.5 1.5 0 0 1-2.1-2.1l6.6-6.6" />
  </Svg>
);

export const IconPin = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 3.8h6l-.8 5.4 3 3.2H6.8l3-3.2z" />
    <path d="M12 12.4v7.8" />
  </Svg>
);

export const IconMapPin = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21c4-4.2 6-7.4 6-10a6 6 0 0 0-12 0c0 2.6 2 5.8 6 10Z" />
    <circle cx="12" cy="10.8" r="2.2" />
  </Svg>
);

export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.4V12l3 1.8" />
  </Svg>
);

export const IconGlobe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M3.6 12h16.8M12 3.6c2.2 2.4 3.3 5.2 3.3 8.4s-1.1 6-3.3 8.4c-2.2-2.4-3.3-5.2-3.3-8.4S9.8 6 12 3.6Z" />
  </Svg>
);

export const IconMail = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.2" y="5.4" width="17.6" height="13.2" rx="1.6" />
    <path d="m3.8 6.6 8.2 6 8.2-6" />
  </Svg>
);

export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4.6h5.4V10M19 5 11.6 12.4" />
    <path d="M18.4 14v4.4a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 18.4V7.2a1.6 1.6 0 0 1 1.6-1.6H10" />
  </Svg>
);

export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.4 19 6v6c0 4-2.9 7.2-7 8.6C7.9 19.2 5 16 5 12V6Z" />
    <path d="m9.2 12 2 2 3.6-3.8" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10.8" cy="10.8" r="6.4" />
    <path d="m15.6 15.6 4.4 4.4" />
  </Svg>
);

export const IconSwitch = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.4 8.4h13.2l-3.4-3.6M19.6 15.6H6.4l3.4 3.6" />
  </Svg>
);

export const IconSmile = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M8.6 14.2a4 4 0 0 0 6.8 0" />
    <path d="M9.2 9.6h.01M14.8 9.6h.01" strokeWidth={2} />
  </Svg>
);
