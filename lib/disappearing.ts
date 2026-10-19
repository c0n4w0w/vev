import type { MessageKey } from "@/lib/i18n";

/**
 * Disappearing messages in direct conversations: the durations on offer and
 * their names. What they mean is decided by the database
 * (20261107100000_disappearing_direct_messages.sql); this only lists them.
 *
 * Each message keeps the duration the conversation had when it was written.
 * Its timer starts when the recipient first reads it, and an unread message
 * lasts at most 30 days.
 */
export const DISAPPEAR_OPTIONS = [3600, 28800, 86400, 604800, 2419200] as const;

export type DisappearSeconds = (typeof DISAPPEAR_OPTIONS)[number];

export function isDisappearSeconds(value: unknown): value is DisappearSeconds {
  return typeof value === "number" && (DISAPPEAR_OPTIONS as readonly number[]).includes(value);
}

/** «1 time», «1 dag» … */
export const DISAPPEAR_LABEL: Record<DisappearSeconds, MessageKey> = {
  3600: "dm.disappearing.option.3600",
  28800: "dm.disappearing.option.28800",
  86400: "dm.disappearing.option.86400",
  604800: "dm.disappearing.option.604800",
  2419200: "dm.disappearing.option.2419200",
};
