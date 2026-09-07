import Link from "next/link";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import type { CommunityPublic, RoleId, User } from "@/lib/types";
import { roles } from "@/lib/roles";

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

// ── Avatar ──────────────────────────────────────────────────────────────

const avatarSizes = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-xs",
  lg: "h-14 w-14 text-base",
  xl: "h-20 w-20 text-xl",
} as const;

/**
 * Monogram avatars. The tint is derived from the user id so a person keeps the
 * same colour everywhere without storing one.
 */
const tints = [
  "bg-[#e6ece7] text-[#28503f]",
  "bg-[#eae7df] text-[#6b5a3e]",
  "bg-[#e4ebef] text-[#2f5a73]",
  "bg-[#f0e6e1] text-[#8a4c33]",
  "bg-[#e8e8ea] text-[#3b3b40]",
  "bg-[#e9ece4] text-[#4c5b34]",
];

function tintFor(id: string) {
  let sum = 0;
  for (let i = 0; i < id.length; i += 1) sum += id.charCodeAt(i);
  return tints[sum % tints.length];
}

export function Avatar({
  user,
  size = "md",
  className,
}: {
  user: Pick<User, "id" | "initials" | "name">;
  size?: keyof typeof avatarSizes;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-wide",
        avatarSizes[size],
        tintFor(user.id),
        className,
      )}
      title={user.name}
    >
      {user.initials}
    </span>
  );
}

// ── Community mark ──────────────────────────────────────────────────────

const markSizes = {
  xs: "h-6 w-6 text-[9px] rounded-[5px]",
  sm: "h-8 w-8 text-[10px] rounded-[6px]",
  md: "h-11 w-11 text-xs rounded-[8px]",
  lg: "h-16 w-16 text-base rounded-[10px]",
} as const;

const markFonts = {
  serif: "font-display",
  sans: "font-sans",
  mono: "font-mono",
} as const;

/** Each community's square monogram, tinted with its own accent colour. */
export function CommunityMark({
  community,
  size = "md",
  className,
}: {
  community: Pick<CommunityPublic, "branding">;
  size?: keyof typeof markSizes;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center font-semibold tracking-[0.04em] text-white",
        markSizes[size],
        markFonts[community.branding.markStyle],
        className,
      )}
      style={{ backgroundColor: community.branding.accent }}
      aria-hidden="true"
    >
      {community.branding.monogram}
    </span>
  );
}

// ── Badges ──────────────────────────────────────────────────────────────

const badgeTones = {
  neutral: "bg-paper-2 text-ink-2 border-line",
  skog: "bg-skog-soft text-skog border-[#cfdfd5]",
  fjord: "bg-fjord-soft text-fjord border-[#cddce4]",
  rust: "bg-rust-soft text-rust border-[#e7cec4]",
  outline: "bg-transparent text-ink-3 border-line",
} as const;

export function Badge({
  children,
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: keyof typeof badgeTones }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[11px] font-medium leading-4",
        badgeTones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

const roleTone: Record<RoleId, keyof typeof badgeTones> = {
  admin: "skog",
  moderator: "fjord",
  member: "outline",
};

export function RoleBadge({ role, className }: { role: RoleId; className?: string }) {
  return (
    <Badge tone={roleTone[role]} className={className} title={roles[role].description}>
      {roles[role].label}
    </Badge>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-[5px] text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const buttonVariants = {
  primary: "bg-skog text-white hover:bg-skog-2",
  secondary: "bg-surface text-ink border border-line-2 hover:bg-paper-2",
  ghost: "text-ink-2 hover:bg-paper-2 hover:text-ink",
  quiet: "text-ink-3 hover:text-ink",
} as const;

const buttonSizes = {
  sm: "h-8 px-3",
  md: "h-10 px-4",
  lg: "h-11 px-5",
} as const;

type ButtonStyleProps = {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
};

export function buttonClass({ variant = "primary", size = "md" }: ButtonStyleProps = {}) {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size]);
}

export function Button({
  variant,
  size,
  className,
  ...props
}: ComponentProps<"button"> & ButtonStyleProps) {
  return <button className={cn(buttonClass({ variant, size }), className)} {...props} />;
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & ButtonStyleProps) {
  return <Link className={cn(buttonClass({ variant, size }), className)} {...props} />;
}

// ── Layout pieces ───────────────────────────────────────────────────────

/** White card on the warm background — the base surface for most content. */
export function Panel({
  children,
  className,
  as: Tag = "div",
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" | "li" }) {
  return (
    <Tag className={cn("rounded-[6px] border border-line bg-surface", className)} {...props}>
      {children}
    </Tag>
  );
}

/** Page heading used across every authenticated screen. */
export function PageHeader({
  title,
  lead,
  action,
  eyebrow,
}: {
  title: string;
  lead?: string;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? <p className="label mb-2">{eyebrow}</p> : null}
        <h1 className="font-display text-[1.75rem] leading-tight text-ink sm:text-[2.125rem]">
          {title}
        </h1>
        {lead ? <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">{lead}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function SectionHeading({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="label">{children}</h2>
      {action}
    </div>
  );
}

/** Calm empty states — a short explanation, never an illustration. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[6px] border border-dashed border-line-2 bg-surface/60 px-6 py-12 text-center">
      <h3 className="font-display text-lg text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">{body}</p>
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Renders mock body copy: blank lines become paragraphs. */
export function RichText({ body, className }: { body: string; className?: string }) {
  return (
    <div className={cn("space-y-3 text-[0.9375rem] leading-[1.7] text-ink-2", className)}>
      {body.split("\n\n").map((paragraph, index) => (
        <p key={index} className="whitespace-pre-line">
          {paragraph}
        </p>
      ))}
    </div>
  );
}

/** Consistent page gutters and measure for every authenticated screen. */
export function PageContainer({
  children,
  className,
  width = "default",
}: {
  children: ReactNode;
  className?: string;
  width?: "default" | "narrow" | "wide";
}) {
  const widths = {
    narrow: "max-w-3xl",
    default: "max-w-4xl",
    wide: "max-w-6xl",
  } as const;
  return (
    <div className={cn("mx-auto px-5 py-8 lg:px-10 lg:py-12", widths[width], className)}>
      {children}
    </div>
  );
}
