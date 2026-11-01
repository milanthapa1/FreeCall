import type { RealtimeEnv } from "@freecall/config";
import {
  aggregateStatus,
  httpStatusFor,
  probeDependency,
  type HealthReport,
} from "@freecall/observability";
import { Redis } from "ioredis";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * Health endpoints live on a loopback-only port so they are reachable by the orchestrator
 * but not by the public internet. `/healthz` answers "is this process alive"; `/readyz`
 * answers "should traffic be routed here", which includes Redis and LiveKit reachability.
 */

export interface RealtimeHealthDependencies {
  env: RealtimeEnv;
  version: string;
  isDraining: () => boolean;
  isStopping: () => boolean;
  /** Live socket count from the WebSocket server. */
  getSocketCount: () => number;
}

export interface RealtimeHealthServer {
  readonly port: number;
  close(): Promise<void>;
}

const PROBE_TIMEOUT_MS = 2_500;

export async function startRealtimeHealthServer(
  deps: RealtimeHealthDependencies,
): Promise<RealtimeHealthServer> {
  const { env } = deps;

  const server = createServer((request, response) => {
    void route(request, response, deps);
  });

  await listen(server, env.HTTP_PORT);
  return {
    port: env.HTTP_PORT,
    close: () => closeServer(server),
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  deps: RealtimeHealthDependencies,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://realtime.invalid");

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  if (url.pathname === "/stats") {
    sendJson(response, 200, {
      onlineCount: deps.getSocketCount(),
      draining: deps.isDraining(),
      ts: Date.now(),
    });
    return;
  }

  if (url.pathname === "/healthz") {
    const alive = !deps.isStopping();
    sendJson(response, alive ? 200 : 503, {
      status: alive ? "ok" : "stopping",
      service: "realtime",
      version: deps.version,
      uptimeSeconds: Math.round(process.uptime()),
      draining: deps.isDraining(),
    });
    return;
  }

  if (url.pathname === "/readyz") {
    if (deps.isDraining() || deps.isStopping()) {
      sendJson(response, 503, {
        status: "down",
        service: "realtime",
        reason: "draining",
      });
      return;
    }

    const report = await buildReport(deps);
    sendJson(response, httpStatusFor(report.status), report);
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

async function buildReport(deps: RealtimeHealthDependencies): Promise<HealthReport> {
  const [redis, livekit] = await Promise.all([
    probeDependency("redis", () => checkRedis(deps.env), { timeoutMs: PROBE_TIMEOUT_MS }),
    probeDependency("livekit", () => checkLiveKit(deps.env), { timeoutMs: PROBE_TIMEOUT_MS }),
  ]);

  const dependencies = { redis, livekit };
  return {
    service: "realtime",
    version: deps.version,
    status: aggregateStatus(Object.values(dependencies)),
    checkedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    dependencies,
  };
}

async function checkRedis(env: RealtimeEnv): Promise<"up" | "not_configured"> {
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1_500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });

  try {
    await client.connect();
    const reply = await client.ping();
    if (reply !== "PONG") throw new Error("redis ping failed");
    return "up";
  } finally {
    client.disconnect();
  }
}

async function checkLiveKit(env: RealtimeEnv): Promise<"up" | "not_configured"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  timer.unref?.();

  try {
    const response = await fetch(new URL("/", env.LIVEKIT_API_URL), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "text/plain" },
    });
    if (!response.ok) throw new Error(`livekit responded ${response.status}`);
    return "up";
  } finally {
    clearTimeout(timer);
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store, max-age=0",
    connection: "close",
  });
  response.end(payload);
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}
