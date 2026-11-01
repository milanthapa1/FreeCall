/**
 * k6 load test — matchmaking throughput scenario.
 *
 * Tests the realtime WebSocket matchmaking path under load.
 * Run: k6 run --env WS_URL=ws://localhost:8080/v1 infra/k6/matchmaking.js
 */

import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import { randomUUID } from "k6/crypto";
import http from "k6/http";

const matchedCount = new Counter("matched_total");
const matchLatency = new Trend("match_latency_ms", true);
const guestStartErrors = new Counter("guest_start_errors");

export const options = {
  scenarios: {
    matchmaking: {
      executor: "ramping-vus",
      stages: [
        { duration: "30s", target: 50 },
        { duration: "60s", target: 100 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    match_latency_ms: ["p(95)<5000"],
    matched_total: ["count>50"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const WS_URL = __ENV.WS_URL || "ws://localhost:8080/v1";

function getToken() {
  const res = http.post(
    `${BASE_URL}/api/guest/start`,
    JSON.stringify({
      dob: "1990-01-01",
      attestation: true,
    }),
    { headers: { "Content-Type": "application/json" } },
  );

  if (res.status !== 200) {
    guestStartErrors.add(1);
    return null;
  }

  return JSON.parse(res.body).token;
}

export default function () {
  const token = getToken();
  if (!token) {
    sleep(1);
    return;
  }

  const enqueueTime = Date.now();

  const res = ws.connect(WS_URL, {}, (socket) => {
    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          v: 1,
          type: "hello",
          id: randomUUID(),
          data: {
            token,
            client: { platform: "web", version: "1.0.0", locale: "en-US" },
          },
        }),
      );
    });

    socket.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      if (msg.type === "hello_ok") {
        socket.send(
          JSON.stringify({
            v: 1,
            type: "enqueue",
            id: randomUUID(),
            data: { country: "any", mode: "solo", lang: "en" },
          }),
        );
      }

      if (msg.type === "matched") {
        const latency = Date.now() - enqueueTime;
        matchLatency.add(latency);
        matchedCount.add(1);
        socket.close();
      }

      if (msg.type === "error") {
        socket.close();
      }
    });

    socket.on("error", () => socket.close());
    socket.setTimeout(() => socket.close(), 60_000);
  });

  check(res, { "websocket connected": (r) => r && r.status === 101 });
  sleep(1);
}
