/**
 * Which deployment this process is.
 *
 * TING runs the same code in two places: the real platform at join-ting.no,
 * and a showcase deployment pointed at a separate Supabase project full of
 * fixtures. Everything that exists only to make a demo convenient — seeding,
 * showcase entry links — is gated on this, so that a production deployment
 * cannot be talked into any of it.
 *
 * Three properties matter, and they are why this is written the way it is:
 *
 * 1. **Production is the default.** Absence of configuration means production.
 *    A deployment that forgets to set anything gets the safe answer, and the
 *    demo has to be asked for explicitly.
 *
 * 2. **Server-only.** `TING_MODE` deliberately has no `NEXT_PUBLIC_` prefix, so
 *    it is never inlined into a browser bundle and no demo affordance can leak
 *    into the client build. It is also read at runtime, so switching it is a
 *    restart rather than a rebuild.
 *
 * 3. **One answer per process.** Nothing branches on hostname, community slug
 *    or database URL. Those are guesses; this is a statement.
 */
export type DeploymentMode = "production" | "demo";

export function deploymentMode(): DeploymentMode {
  return process.env.TING_MODE?.trim().toLowerCase() === "demo" ? "demo" : "production";
}

/** True only on a deployment explicitly configured as a showcase. */
export function isDemoDeployment(): boolean {
  return deploymentMode() === "demo";
}

/**
 * Refuses to continue outside a demo deployment.
 *
 * For code paths that must never execute against production data — the seed,
 * showcase entry. Throwing rather than returning a flag means a caller cannot
 * forget to check the result.
 */
export function assertDemoDeployment(what: string): void {
  if (isDemoDeployment()) return;
  throw new Error(
    `${what} is only available on a demo deployment. ` +
      `This process is running as "${deploymentMode()}". ` +
      `If this really is the showcase deployment, set TING_MODE=demo; ` +
      `if it is production, this was the correct outcome.`,
  );
}
