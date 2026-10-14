import type { Channel, LocalGroup } from "./types";

/**
 * The destinations on the "Kom i gang" welcome card, resolved from what one
 * community actually has. Nothing here is invented: a step whose destination
 * does not exist is left out rather than linked somewhere dead, no channel or
 * group is ever created for it, and no channel is looked for by its id or
 * address — a community's channels are whatever its administrators made.
 *
 * Pure on purpose, so the checks can exercise it without a database.
 */
export type OnboardingStep =
  | { kind: "profile"; href: string }
  | { kind: "lokallag"; href: string }
  | { kind: "introductions"; href: string; channelName: string }
  | { kind: "channel"; href: string; channelName: string }
  | { kind: "createChannel"; href: string }
  | { kind: "feed"; href: string };

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

/**
 * The channels a newcomer could join in: the community's own, active and
 * writable. A read-only or archived channel cannot be posted in, and lokallag
 * or group chats belong to a smaller circle than "the others". In the order
 * the sidebar lists them.
 */
function openChannels(channels: Channel[]): Channel[] {
  return channels.filter(
    (channel) => !channel.readOnly && !channel.archived && !channel.localGroupId && !channel.subgroupId,
  );
}

/**
 * The channel a new member should say hello in, or undefined if the community
 * has none that says it is for that — by its name, or by its description.
 */
export function pickIntroductionChannel(channels: Channel[]): Channel | undefined {
  const open = openChannels(channels);
  return (
    open.find((channel) => INTRODUCTION_NAMES.has(channel.name.toLowerCase())) ??
    open.find((channel) => INTRODUCTION_PURPOSE.test(channel.purpose))
  );
}

export function onboardingSteps({
  communityId,
  localGroups,
  channels,
  viewerIsAdmin = false,
}: {
  communityId: string;
  localGroups: LocalGroup[];
  /** In sidebar order, as the viewer can read them. */
  channels: Channel[];
  /** An active administrator of the community, who may create its channels. */
  viewerIsAdmin?: boolean;
}): OnboardingStep[] {
  const base = `/community/${communityId}`;
  const steps: OnboardingStep[] = [{ kind: "profile", href: `${base}/profile/edit` }];

  // The same rule the sidebar uses to show Lokallag at all: a community with
  // no active local group does not have the feature.
  if (localGroups.some((group) => group.active)) {
    steps.push({ kind: "lokallag", href: `${base}/lokallag` });
  }

  // A channel made for introductions; otherwise the first channel anyone can
  // write in; otherwise — a community that has no channel yet — its
  // administrators are offered to create one and everyone else the feed,
  // which every community has.
  const introductions = pickIntroductionChannel(channels);
  const first = openChannels(channels)[0];
  if (introductions) {
    steps.push({ kind: "introductions", href: `${base}/channel/${introductions.id}`, channelName: introductions.name });
  } else if (first) {
    steps.push({ kind: "channel", href: `${base}/channel/${first.id}`, channelName: first.name });
  } else if (viewerIsAdmin) {
    steps.push({ kind: "createChannel", href: `${base}/kanaler?ny=kanal` });
  } else {
    steps.push({ kind: "feed", href: `${base}/feed` });
  }

  return steps;
}
