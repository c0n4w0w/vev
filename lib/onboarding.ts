import type { Channel, LocalGroup } from "./types";

/**
 * The destinations on the "Kom i gang" welcome card, resolved from what one
 * community actually has. Nothing here is invented: a step whose destination
 * does not exist is left out rather than linked somewhere dead, and no channel
 * or group is ever created for it.
 *
 * Pure on purpose, so the checks can exercise it without a database.
 */
export type OnboardingStep =
  | { kind: "profile"; href: string }
  | { kind: "lokallag"; href: string }
  | { kind: "introductions"; href: string; channelName: string };

/** Channel names that are an introductions channel by name alone. */
const INTRODUCTION_NAMES = new Set([
  "presentasjoner",
  "presentasjon",
  "introduksjoner",
  "introduksjon",
  "introductions",
  "introduction",
  "intros",
  "velkommen",
  "welcome",
]);

/** Purposes that describe an introductions channel ("Ny her? Skriv noen linjer om deg selv."). */
const INTRODUCTION_PURPOSE = /\bny her\b|\bpresenter|\bintrodu|\bnew here\b|om deg selv|about yourself/i;

/** The general chat a community has when it has no introductions channel. */
const GENERAL_NAMES = new Set(["generelt", "general"]);

/**
 * The channel a new member should say hello in, or undefined if the community
 * has nothing suitable. Only ordinary community-wide channels qualify: a
 * read-only channel cannot be posted in, and lokallag or subgroup chats belong
 * to a smaller circle than "the others".
 *
 * Order: an introductions channel by name, then one whose purpose says so,
 * then the community's general channel.
 */
export function pickIntroductionChannel(channels: Channel[]): Channel | undefined {
  const open = channels.filter(
    (channel) => !channel.readOnly && !channel.localGroupId && !channel.subgroupId,
  );
  return (
    open.find((channel) => INTRODUCTION_NAMES.has(channel.name.toLowerCase())) ??
    open.find((channel) => INTRODUCTION_PURPOSE.test(channel.purpose)) ??
    open.find((channel) => GENERAL_NAMES.has(channel.name.toLowerCase()))
  );
}

export function onboardingSteps({
  communityId,
  localGroups,
  channels,
}: {
  communityId: string;
  localGroups: LocalGroup[];
  channels: Channel[];
}): OnboardingStep[] {
  const base = `/community/${communityId}`;
  const steps: OnboardingStep[] = [{ kind: "profile", href: `${base}/profile/edit` }];

  // The same rule the sidebar uses to show Lokallag at all: a community with
  // no active local group does not have the feature.
  if (localGroups.some((group) => group.active)) {
    steps.push({ kind: "lokallag", href: `${base}/lokallag` });
  }

  const channel = pickIntroductionChannel(channels);
  if (channel) {
    steps.push({
      kind: "introductions",
      href: `${base}/channel/${channel.id}`,
      channelName: channel.name,
    });
  }

  return steps;
}
