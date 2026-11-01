import { describe, expect, it } from "vitest";
import { redactText, scrubSentryEvent } from "../src/redact";

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

describe("redactText", () => {
  it("removes credentials from connection strings but keeps the scheme", () => {
    expect(redactText("postgres://app:hunter2@db.internal:5432/freecall")).toBe(
      "postgres://[redacted:credentials]@db.internal:5432/freecall",
    );
    expect(redactText("redis://default:secret@cache:6379")).toBe(
      "redis://[redacted:credentials]@cache:6379",
    );
  });

  it("redacts JWTs", () => {
    expect(redactText(`authorization=${JWT}`)).toBe("authorization=[redacted:jwt]");
  });

  it("redacts bearer tokens", () => {
    expect(redactText("Bearer abcdef1234567890")).toBe("Bearer [redacted:token]");
  });

  it("redacts email addresses", () => {
    expect(redactText("contact jane.doe+tag@example.co.uk now")).toBe(
      "contact [redacted:email] now",
    );
  });

  it("redacts IPv4 and IPv6 addresses", () => {
    expect(redactText("from 203.0.113.9 and 10.0.0.1")).toBe(
      "from [redacted:ip] and [redacted:ip]",
    );
    expect(redactText("peer 2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe("peer [redacted:ip]");
    expect(redactText("peer 2001:db8::1")).toBe("peer [redacted:ip]");
  });

  it("redacts long digit runs such as card and phone numbers", () => {
    expect(redactText("card 4242 4242 4242 4242")).toBe("card [redacted:number]");
    expect(redactText("id 1234567890123")).toBe("id [redacted:number]");
  });

  it("leaves ordinary text untouched", () => {
    const text = "match created in region iad after 250ms (step 2)";
    expect(redactText(text)).toBe(text);
  });
});

describe("scrubSentryEvent", () => {
  it("removes request data, extras, breadcrumbs and attachments", () => {
    const scrubbed = scrubSentryEvent({
      event_id: "abc",
      message: "failed for person@example.com",
      request: { headers: { cookie: "session=secret" }, data: { password: "x" } },
      extra: { rawBody: "hello" },
      breadcrumbs: [{ message: "clicked 203.0.113.9" }],
      attachments: [{ filename: "frame.jpg" }],
    });

    expect(scrubbed).not.toHaveProperty("request");
    expect(scrubbed).not.toHaveProperty("extra");
    expect(scrubbed).not.toHaveProperty("breadcrumbs");
    expect(scrubbed).not.toHaveProperty("attachments");
    expect(scrubbed["event_id"]).toBe("abc");
    expect(scrubbed["message"]).toBe("failed for [redacted:email]");
  });

  it("keeps only the opaque user id", () => {
    const scrubbed = scrubSentryEvent({
      user: { id: "user_123", email: "person@example.com", ip_address: "203.0.113.9" },
    });
    expect(scrubbed["user"]).toEqual({ id: "user_123" });

    const anonymous = scrubSentryEvent({ user: { email: "person@example.com" } });
    expect(anonymous).not.toHaveProperty("user");
  });

  it("redacts tag values and exception messages but keeps the stack", () => {
    const scrubbed = scrubSentryEvent({
      tags: { route: "/u/person@example.com", region: "iad" },
      exception: {
        values: [
          {
            type: "Error",
            value: "failed for person@example.com",
            stacktrace: { frames: [{ filename: "server.js", lineno: 10 }] },
          },
        ],
      },
    });

    expect(scrubbed["tags"]).toEqual({ route: "/u/[redacted:email]", region: "iad" });
    const exception = scrubbed["exception"] as {
      values: Array<{ value: string; stacktrace: unknown }>;
    };
    expect(exception.values[0]?.value).toBe("failed for [redacted:email]");
    expect(exception.values[0]?.stacktrace).toEqual({
      frames: [{ filename: "server.js", lineno: 10 }],
    });
  });

  it("marks unserialisable exception entries instead of leaking them", () => {
    const scrubbed = scrubSentryEvent({
      exception: { values: ["raw string", 42, null] },
    });
    const exception = scrubbed["exception"] as { values: Array<{ value: string }> };
    expect(exception.values.map((entry) => entry.value)).toEqual([
      "[unserializable exception entry]",
      "[unserializable exception entry]",
      "[unserializable exception entry]",
    ]);
  });

  it("returns an empty object for non-events", () => {
    expect(scrubSentryEvent(null)).toEqual({});
    expect(scrubSentryEvent("nope")).toEqual({});
    expect(scrubSentryEvent(undefined)).toEqual({});
  });
});
