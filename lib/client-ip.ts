import { isIP } from "node:net";

/**
 * The network address a request really came from — or nothing, when that
 * cannot be known.
 *
 * `X-Forwarded-For` is a list that every hop appends to, and its left end is
 * whatever the caller chose to send. The only entries worth anything are the
 * ones appended by proxies this deployment runs itself, which are the last
 * ones. So the deployment says how many of its own proxies stand in front of
 * the app (`TRUSTED_PROXY_COUNT`; one, for nginx alone), and the address taken
 * is the one that many places from the right: what the outermost trusted proxy
 * saw connect to it. Nothing to its left is read at all.
 *
 * Unset means no proxy is trusted and the answer is always "unknown" — never
 * a guess. Without a proxy the header is either absent or entirely the
 * caller's, and an address a caller can choose is worse than none: limits
 * keyed on it could be dodged, or aimed at somebody else.
 *
 * Pure on purpose, so the checks can exercise it without a server.
 */
export function clientIpFrom(
  forwardedFor: string | null | undefined,
  trustedProxies: number,
): string | undefined {
  if (!forwardedFor || !Number.isInteger(trustedProxies) || trustedProxies < 1) return undefined;
  const hops = forwardedFor.split(",").map((hop) => hop.trim());
  // Fewer entries than proxies means the request did not come through them.
  if (hops.length < trustedProxies) return undefined;
  return limitKeyFor(hops[hops.length - trustedProxies]);
}

/** `TRUSTED_PROXY_COUNT` as a small positive whole number, or 0. */
export function trustedProxyCount(): number {
  const configured = Number(process.env.TRUSTED_PROXY_COUNT);
  return Number.isInteger(configured) && configured >= 1 && configured <= 10 ? configured : 0;
}

/**
 * What to count against for one address: an IPv4 address as it is, an IPv6
 * address by its /64 — the block one subscriber is given, and can otherwise
 * walk through at will. Anything that is not an address is nothing.
 */
function limitKeyFor(value: string): string | undefined {
  const address = value.replace(/%.*$/, "").toLowerCase();
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6) return undefined;

  // An IPv4 address written the IPv6 way.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];

  const [head, tail] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = address.includes("::")
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
    : left;
  const prefix = groups.slice(0, 4);
  if (prefix.length < 4 || prefix.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return address;
  return `${prefix.map((group) => parseInt(group, 16).toString(16)).join(":")}::/64`;
}
