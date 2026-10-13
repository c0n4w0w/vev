/**
 * Tells Supabase Auth whose request this really is.
 *
 * Auth limits sign-ins, emailed links and token refreshes per network
 * address. Every one of those reaches it from TING's server, so without help
 * it sees one caller for the whole membership: enough traffic from anywhere
 * uses up the allowance for everybody. Supabase's answer is the
 * `Sb-Forwarded-For` header, which it believes only on a request made with a
 * secret API key (`sb_secret_…`) and only once the project has IP Address
 * Forwarding switched on.
 *
 * A secret key is the service role by another name, and Supabase's own
 * example hands it to the whole request-scoped client. That is not done here.
 * The clients stay what they are — the public key and the member's own
 * session, with row level security deciding what they see — and this wraps
 * the `fetch` underneath them so that:
 *
 * - only a request to the Auth endpoints Supabase limits per address is
 *   touched (the list below). A request to the data API, storage or anything
 *   else passes through exactly as it was, so the secret key never travels
 *   with a query and cannot lift a row rule;
 * - on those requests two headers change and nothing else: `apikey` becomes
 *   the secret key, and `Sb-Forwarded-For` carries the caller's address.
 *   `Authorization` — the member's token, or the public key when nobody is
 *   signed in — is left as the client wrote it;
 * - the address is one this deployment's own proxy vouched for
 *   (lib/client-ip.ts). With none, nothing is forwarded: an address the caller
 *   could choose would let them pick whose allowance they spend.
 *
 * Without a secret key configured this is the plain `fetch` it was given, and
 * the app behaves as it did before.
 *
 * If Supabase rejects the secret key itself — revoked, mistyped, deleted
 * during a rotation — the request is sent again the ordinary way, and
 * forwarding steps aside for a few minutes. A bad key then costs the
 * per-address limits, not everyone's ability to sign in. That is the only
 * thing ever sent twice: a wrong password, an expired token or a "too many
 * requests" is Auth's answer and is passed on as it is (see `keyWasRefused`).
 *
 * Pure but for the breaker's clock, and free of `server-only`, so the checks
 * can exercise it under plain node. It must still never be imported by a
 * Client Component: it handles the secret key.
 */

/** The Auth endpoints Supabase limits per network address, as TING calls them. */
const FORWARDED_ENDPOINTS: readonly { method: string; path: string }[] = [
  { method: "POST", path: "/token" }, // password sign-in, token refresh, PKCE exchange
  { method: "POST", path: "/otp" }, // emailed sign-in link
  { method: "POST", path: "/recover" }, // password reset email
  { method: "POST", path: "/verify" }, // redeeming an emailed link
  { method: "GET", path: "/verify" },
  { method: "PUT", path: "/user" }, // password and email changes
];

const SECRET_KEY = /^sb_secret_[A-Za-z0-9_-]{8,}$/;
const BREAKER_MS = 5 * 60_000;

export type AuthForwarding = {
  /** The project URL the clients were created with. */
  supabaseUrl: string;
  /** `SUPABASE_SECRET_KEY`, if the deployment has one. */
  secretKey: string | undefined;
  /** The caller's address as vouched for by the deployment's proxy, if known. */
  clientAddress: string | undefined;
};

/** Until when forwarding stands aside, per secret key that was refused. */
const refusedUntil = new Map<string, number>();

/**
 * Whether a response is the API gateway refusing the key — and nothing else.
 *
 * The gateway in front of Auth answers 401 with `{"message": "Invalid API
 * key", …}` (or "Unregistered…", "No API key found…"): a `message` about the
 * API key, and none of the fields Auth itself puts on an error. Auth's own
 * refusals — a bad or expired token, wrong credentials — carry `error_code`
 * and `msg`, and are never this. Anything that cannot be read as the first
 * kind is treated as the second: when in doubt, the request is not repeated.
 */
async function keyWasRefused(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  let body: unknown;
  try {
    body = JSON.parse(await response.clone().text());
  } catch {
    return false;
  }
  if (typeof body !== "object" || body === null) return false;
  const fields = body as Record<string, unknown>;
  if ("error_code" in fields || "msg" in fields || "code" in fields || "error" in fields) return false;
  return typeof fields.message === "string" && /\bapi key\b/i.test(fields.message);
}

/** Whether a value can be a secret key at all. Never logs or returns it. */
export function looksLikeSecretKey(value: string | undefined): value is string {
  return typeof value === "string" && SECRET_KEY.test(value);
}

function isForwardedEndpoint(base: URL, url: URL, method: string): boolean {
  if (url.origin !== base.origin) return false;
  const root = `${base.pathname.replace(/\/+$/, "")}/auth/v1`;
  if (!url.pathname.startsWith(`${root}/`)) return false;
  const path = url.pathname.slice(root.length).replace(/\/+$/, "");
  return FORWARDED_ENDPOINTS.some((endpoint) => endpoint.method === method && endpoint.path === path);
}

/**
 * `baseFetch`, with the caller's address forwarded on Auth's rate-limited
 * endpoints when — and only when — there is a secret key and a trusted address.
 */
export function withAuthForwarding(baseFetch: typeof fetch, config: AuthForwarding): typeof fetch {
  const { secretKey, clientAddress } = config;
  if (!looksLikeSecretKey(secretKey) || !clientAddress) return baseFetch;

  let base: URL;
  try {
    base = new URL(config.supabaseUrl);
  } catch {
    return baseFetch;
  }

  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    let url: URL;
    try {
      url = new URL(request ? request.url : String(input));
    } catch {
      return baseFetch(input, init);
    }

    if (!isForwardedEndpoint(base, url, method)) return baseFetch(input, init);
    if ((refusedUntil.get(secretKey) ?? 0) > Date.now()) return baseFetch(input, init);

    const headers = new Headers(init?.headers ?? request?.headers);
    headers.set("apikey", secretKey);
    headers.set("Sb-Forwarded-For", clientAddress);
    const response = await baseFetch(input, { ...init, headers });

    // The one case in which a request is sent again: the gateway said, in so
    // many words, that it does not accept this key. Not a failed sign-in, not
    // an expired token, not a rate limit — those are answers, and stand.
    if (!(await keyWasRefused(response))) return response;

    refusedUntil.set(secretKey, Date.now() + BREAKER_MS);
    console.error(
      "[auth-forwarding] Supabase refused SUPABASE_SECRET_KEY. The caller's address is not being " +
        "forwarded; Auth's limits apply to this server as a whole until the key is fixed. " +
        "Check that the key exists and is not revoked, then restart.",
    );

    // Only a request whose body can be sent twice is tried again; the Supabase
    // client sends strings.
    const body = init?.body;
    const replayable = !request && (body === undefined || body === null || typeof body === "string");
    return replayable ? baseFetch(input, init) : response;
  };
}

/** For the checks: forget any refusal remembered by an earlier case. */
export function resetAuthForwardingBreaker(): void {
  refusedUntil.clear();
}
