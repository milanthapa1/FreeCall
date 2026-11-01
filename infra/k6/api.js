/**
 * k6 load test — API endpoints (guest start, health).
 *
 * Run: k6 run --env BASE_URL=http://localhost:3000 infra/k6/api.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const errorRate = new Rate("errors");

export const options = {
  scenarios: {
    guest_start: {
      executor: "constant-arrival-rate",
      rate: 60,         // 60 req/s
      timeUnit: "1s",
      duration: "60s",
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    errors: ["rate<0.05"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export default function () {
  // Health check
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, { "health 200": (r) => r.status === 200 });

  // Guest start (rate limit will kick in; 429 is expected and acceptable)
  const start = http.post(
    `${BASE_URL}/api/guest/start`,
    JSON.stringify({ dob: "1990-06-15", attestation: true }),
    { headers: { "Content-Type": "application/json" } },
  );
  const ok = start.status === 200 || start.status === 429;
  errorRate.add(!ok);

  sleep(0.5);
}
