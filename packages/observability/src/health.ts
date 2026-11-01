/**
 * Health contracts shared by every runtime (web, realtime, worker). The status vocabulary
 * is deliberately small and boring: load balancers and on-call humans both need to answer
 * one question.
 *
 * - `up`             the dependency answered within its budget.
 * - `down`           the dependency is configured but did not answer correctly.
 * - `not_configured` the dependency is optional in this environment (for example object
 *                    storage in a developer checkout). This degrades the service but does
 *                    not make it unhealthy, because the feature that needs it is gated off.
 */

export const DEPENDENCY_NAMES = ["postgres", "redis", "livekit", "storage"] as const;

export type DependencyName = (typeof DEPENDENCY_NAMES)[number];
export type DependencyStatus = "up" | "down" | "not_configured";
export type ServiceStatus = "ok" | "degraded" | "down";
export type DependencyFailure = "timeout" | "error";

export interface DependencyHealth {
  status: DependencyStatus;
  latencyMs?: number;
  failure?: DependencyFailure;
}

export interface HealthReport {
  service: "web" | "realtime" | "worker";
  /** Opaque build identifier, not a user identifier. */
  version: string;
  status: ServiceStatus;
  checkedAt: string;
  uptimeSeconds: number;
  dependencies: Partial<Record<DependencyName | "configuration", DependencyHealth>>;
}

export interface ProbeOptions {
  timeoutMs?: number;
  now?: () => number;
}

export class DependencyTimeoutError extends Error {
  readonly dependency: string;
  readonly timeoutMs: number;

  constructor(dependency: string, timeoutMs: number) {
    super(`dependency "${dependency}" exceeded its ${timeoutMs}ms budget`);
    this.name = "DependencyTimeoutError";
    this.dependency = dependency;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Runs a probe with a hard deadline. A dependency that hangs is worse than one that
 * fails: it consumes a request slot and a connection. The losing promise is allowed to
 * settle in the background, but its rejection is observed so it cannot become an
 * unhandled rejection that crashes the process.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DependencyTimeoutError(label, timeoutMs)), timeoutMs);
    timer.unref?.();
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Converts a probe into a health entry. Probes return `not_configured` explicitly; any
 * thrown error becomes `down` with a coarse failure category. Error messages are not
 * included because driver errors frequently echo a connection string.
 */
export async function probeDependency(
  name: string,
  probe: () => Promise<"up" | "not_configured">,
  options: ProbeOptions = {},
): Promise<DependencyHealth> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const now = options.now ?? (() => performance.now());
  const startedAt = now();

  try {
    const status = await withTimeout(probe(), timeoutMs, name);
    return { status, latencyMs: Math.max(0, Math.round(now() - startedAt)) };
  } catch (error) {
    return {
      status: "down",
      failure: error instanceof DependencyTimeoutError ? "timeout" : "error",
      latencyMs: Math.max(0, Math.round(now() - startedAt)),
    };
  }
}

/**
 * Aggregation rules:
 * - any `down` dependency makes the service `down`, because it cannot honour its contract;
 * - any `not_configured` dependency makes the service `degraded`, because a feature is off;
 * - otherwise `ok`.
 */
export function aggregateStatus(dependencies: Iterable<DependencyHealth>): ServiceStatus {
  let degraded = false;
  for (const dependency of dependencies) {
    if (dependency.status === "down") return "down";
    if (dependency.status === "not_configured") degraded = true;
  }
  return degraded ? "degraded" : "ok";
}

/** HTTP status for a report. Degraded services stay in rotation; down services do not. */
export function httpStatusFor(status: ServiceStatus): 200 | 503 {
  return status === "down" ? 503 : 200;
}
