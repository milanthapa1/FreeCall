import { describe, expect, it } from "vitest";
import { POST } from "../app/api/guest/start/route";

describe("POST /api/guest/start", () => {
  it("rejects invalid input missing dob or attestation", async () => {
    const request = new Request("http://localhost:3000/api/guest/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("invalid_input");
  });

  it("strictly rejects underage users (< 18 years old)", async () => {
    // 16 years old
    const under18Dob = "2010-05-15";
    const request = new Request("http://localhost:3000/api/guest/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dob: under18Dob,
        attestation: true,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("underage");
  });

  it("accepts valid adult DOB (18+) and issues a realtime token and session cookie", async () => {
    const adultDob = "2000-01-01";
    const request = new Request("http://localhost:3000/api/guest/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-ipcountry": "US",
      },
      body: JSON.stringify({
        dob: adultDob,
        attestation: true,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.userId).toBeDefined();
    expect(data.sessionId).toBeDefined();
    expect(data.token).toBeDefined();
    expect(data.ageTier).toBe("t0_declared");
    expect(data.guestMinutesPerDay).toBe(30);

    // Checks cookie
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("fc_session=");
  });

  it("blocks guest creation for blocked or sanctioned markets", async () => {
    const adultDob = "1995-05-10";
    const request = new Request("http://localhost:3000/api/guest/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-ipcountry": "IR", // Iran is sanctioned / blocked
      },
      body: JSON.stringify({
        dob: adultDob,
        attestation: true,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("market_blocked");
  });
});
