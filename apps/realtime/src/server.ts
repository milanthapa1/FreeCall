import type { RealtimeEnv } from "@freecall/config";
import type { Logger } from "@freecall/observability";
import { CLOSE_CODES, LIMITS } from "@freecall/protocol";
import { createServer, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { TokenVerifier } from "./auth.js";
import { CallStateManager } from "./call-state.js";
import {
  ConnectionRegistry,
  clientIp,
  isOriginAllowed,
} from "./connections.js";
import { createLiveKitClient } from "./livekit.js";
import { Matcher } from "./matching/index.js";
import { CrossPodPubSub } from "./pubsub.js";
import { createReportWriter } from "./report-writer.js";
import { SocketSession } from "./session.js";

/**
 * WebSocket transport.
 *
 * `ws` (not uWebSockets.js) is the Phase 0 runtime: its native addons do not yet publish a
 * binary for Node 24/26, and an unbuildable dependency is worse than a lower per-pod socket
 * ceiling. This is recorded in ADR-0002. The handler reads like the uWS design: caps are
 * enforced before the upgrade completes, and the frame cap is configured on the server so
 * oversized frames are rejected before they are buffered.
 */

export interface RealtimeServerDependencies {
  env: RealtimeEnv;
  verifier: TokenVerifier;
  logger: Logger;
  redis: import("ioredis").default;
  /** Optional Postgres URL. When set, reports are persisted. */
  databaseUrl?: string;
}

export interface RealtimeServer {
  readonly wsPort: number;
  readonly sessionCount: number;
  readonly isDraining: boolean;
  /** Sends `draining`, closes every socket, and stops accepting upgrades. */
  drain(): Promise<void>;
  /** Hard shutdown, used by tests and fatal errors. */
  close(): Promise<void>;
}

const MAX_DRAIN_WAIT_MS = 10_000;

export async function startRealtimeServer(
  deps: RealtimeServerDependencies,
): Promise<RealtimeServer> {
  const { env, verifier, logger, redis } = deps;

  const registry = new ConnectionRegistry(env.MAX_SOCKETS_PER_POD, env.MAX_SOCKETS_PER_IP);
  const callState = new CallStateManager();
  const matcher = new Matcher(redis, logger);
  const liveKit = createLiveKitClient({
    LIVEKIT_API_KEY: env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: env.LIVEKIT_API_SECRET,
    LIVEKIT_API_URL: env.LIVEKIT_API_URL,
  });
  const reportWriter = deps.databaseUrl
    ? createReportWriter(deps.databaseUrl)
    : undefined;

  // Dedicated subscriber Redis connection for cross-pod pub/sub.
  // ioredis subscriber clients can only issue subscribe/unsubscribe commands,
  // so we clone the publisher connection config into a separate instance.
  const subscriberRedis = deps.redis.duplicate();
  const pubSub = new CrossPodPubSub(deps.redis, subscriberRedis, logger);

  await matcher.loadScript().catch((err) => {
    logger.warn("matcher.script.load_failed", { errorMessage: String(err) });
  });

  const sessions = new Set<SocketSession>();
  let draining = false;
  let closed = false;

  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    perMessageDeflate: false,
    maxPayload: LIMITS.maxFrameBytes,
  });

  const httpServer = createServer((request, response) => {
    // The public port speaks WebSocket only. Health endpoints live on the loopback port.
    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8",
      connection: "close",
    });
    response.end("not found");
  });

  httpServer.on("upgrade", (request, socket, head) => {
    if (draining || closed) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

    const url = new URL(request.url ?? "/", "http://realtime.invalid");
    if (url.pathname !== "/v1") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    if (!isOriginAllowed(request.headers.origin, env.CORS_ORIGINS)) {
      logger.warn("ws.upgrade.rejected", { reasonCode: "origin_not_allowed" });
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    const ip = clientIp(
      request.socket.remoteAddress,
      request.headers["x-forwarded-for"],
      env.TRUST_PROXY,
    );

    const acquired = registry.acquire(ip);
    if (acquired !== "ok") {
      rejectUpgrade(socket, 429, acquired === "pod_cap" ? "Pod At Capacity" : "Too Many Requests", {
        "retry-after": "5",
      });
      logger.warn("ws.upgrade.rejected", {
        reasonCode: acquired,
        socketCount: registry.size,
      });
      return;
    }

    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      registry.release(ip);
    };

    // A failed handshake never reaches the `connection` callback, so the slot is released
    // when the raw socket closes. When a session exists, its own cleanup releases the slot
    // first and this call becomes a no-op thanks to the guard above.
    socket.once("close", release);

    try {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const session = new SocketSession(ws, ip, {
          env,
          verifier,
          registry,
          logger,
          matcher,
          callState,
          liveKit,
          reportWriter,
          pubSub,
          draining: () => draining,
          onClosed: () => {
            sessions.delete(session);
            release();
          },
        });
        sessions.add(session);
      });
    } catch (error) {
      release();
      logger.error("ws.upgrade.failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      rejectUpgrade(socket, 500, "Internal Server Error");
    }
  });

  httpServer.on("clientError", (_error, socket) => {
    rejectUpgrade(socket, 400, "Bad Request");
  });

  await listen(httpServer, env.WS_PORT);

  logger.info("realtime.listening", {
    socketCount: 0,
    outcome: "started",
  });

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;

    for (const session of sessions) session.drain();

    const deadline = Date.now() + Math.min(env.DRAIN_TIMEOUT, MAX_DRAIN_WAIT_MS);
    while (sessions.size > 0 && Date.now() < deadline) {
      await delay(50);
    }

    for (const session of sessions) {
      session.close(CLOSE_CODES.draining, "shutdown");
    }

    await closeServer(httpServer);
    await pubSub.close();
    closed = true;
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    draining = true;
    for (const session of sessions) session.close(CLOSE_CODES.draining, "shutdown");
    await closeServer(httpServer);
    await pubSub.close();
    closed = true;
  };

  return {
    wsPort: env.WS_PORT,
    get sessionCount(): number {
      return sessions.size;
    },
    get isDraining(): boolean {
      return draining;
    },
    drain,
    close,
  };
}

function rejectUpgrade(
  socket: Duplex,
  status: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  const extra = Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}\r\n`)
    .join("");
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n${extra}\r\n`,
  );
  socket.destroy();
}

/** Tracks whether this raw socket already produced a session; used only for cleanup. */
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
    server.listen(port, "0.0.0.0");
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
