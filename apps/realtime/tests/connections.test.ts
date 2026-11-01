import { describe, expect, it } from "vitest";
import {
  ConnectionRegistry,
  clientIp,
  isOriginAllowed,
  normalizeIp,
  type CloseableConnection,
} from "../src/connections";

function fakeConnection(): CloseableConnection & { closed: Array<[number, string]> } {
  const closed: Array<[number, string]> = [];
  return {
    closed,
    close(code: number, reason: string) {
      closed.push([code, reason]);
    },
  };
}

describe("ConnectionRegistry caps", () => {
  it("admits connections up to the per-IP cap and then refuses", () => {
    const registry = new ConnectionRegistry(100, 2);

    expect(registry.acquire("203.0.113.5")).toBe("ok");
    expect(registry.acquire("203.0.113.5")).toBe("ok");
    expect(registry.acquire("203.0.113.5")).toBe("ip_cap");
    expect(registry.connectionsFor("203.0.113.5")).toBe(2);
    expect(registry.size).toBe(2);
  });

  it("counts each IP separately", () => {
    const registry = new ConnectionRegistry(100, 1);

    expect(registry.acquire("203.0.113.5")).toBe("ok");
    expect(registry.acquire("203.0.113.6")).toBe("ok");
    expect(registry.acquire("203.0.113.5")).toBe("ip_cap");
    expect(registry.size).toBe(2);
  });

  it("reports the pod cap ahead of the per-IP cap so logs name the real cause", () => {
    const registry = new ConnectionRegistry(1, 1);

    expect(registry.acquire("203.0.113.5")).toBe("ok");
    expect(registry.acquire("203.0.113.6")).toBe("pod_cap");
  });

  it("returns capacity on release and can reuse the slot", () => {
    const registry = new ConnectionRegistry(5, 1);

    expect(registry.acquire("203.0.113.5")).toBe("ok");
    registry.release("203.0.113.5");

    expect(registry.size).toBe(0);
    expect(registry.connectionsFor("203.0.113.5")).toBe(0);
    expect(registry.acquire("203.0.113.5")).toBe("ok");
  });

  it("ignores a duplicate release instead of going negative", () => {
    const registry = new ConnectionRegistry(5, 2);
    registry.acquire("203.0.113.5");

    registry.release("203.0.113.5");
    registry.release("203.0.113.5");
    registry.release("203.0.113.5");

    expect(registry.size).toBe(0);
    expect(registry.connectionsFor("203.0.113.5")).toBe(0);
  });

  it("does not free capacity when an unknown IP is released", () => {
    const registry = new ConnectionRegistry(5, 2);
    registry.acquire("203.0.113.5");

    registry.release("198.51.100.9");
    expect(registry.size).toBe(1);
  });

  it("rejects nonsensical caps at construction time", () => {
    expect(() => new ConnectionRegistry(0, 1)).toThrow(/maxTotal/i);
    expect(() => new ConnectionRegistry(1, 0)).toThrow(/maxPerIp/i);
  });
});

describe("ConnectionRegistry per-user replacement", () => {
  it("returns the previous connection so it can be closed as replaced", () => {
    const registry = new ConnectionRegistry(10, 5);
    const first = fakeConnection();
    const second = fakeConnection();

    expect(registry.bindUser("user-1", first)).toBeUndefined();
    expect(registry.bindUser("user-1", second)).toBe(first);
    expect(registry.userConnection("user-1")).toBe(second);
  });

  it("does not return the same connection when a user re-binds itself", () => {
    const registry = new ConnectionRegistry(10, 5);
    const only = fakeConnection();

    registry.bindUser("user-1", only);
    expect(registry.bindUser("user-1", only)).toBeUndefined();
  });

  it("unbinds only when the stored connection is the one that closed", () => {
    const registry = new ConnectionRegistry(10, 5);
    const first = fakeConnection();
    const second = fakeConnection();

    registry.bindUser("user-1", first);
    registry.bindUser("user-1", second);

    // The replaced socket closes after the replacement has taken over its slot.
    registry.unbindUser("user-1", first);
    expect(registry.userConnection("user-1")).toBe(second);

    registry.unbindUser("user-1", second);
    expect(registry.userConnection("user-1")).toBeUndefined();
  });
});

describe("normalizeIp", () => {
  it("folds IPv4-mapped IPv6 addresses onto the plain IPv4 form", () => {
    expect(normalizeIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeIp("127.0.0.1")).toBe("127.0.0.1");
  });

  it("leaves a genuine IPv6 address alone", () => {
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
  });

  it("uses a stable placeholder when the socket has no address", () => {
    expect(normalizeIp(undefined)).toBe("unknown");
    expect(normalizeIp("")).toBe("unknown");
  });
});

describe("clientIp", () => {
  it("ignores forwarded headers when no proxy is trusted", () => {
    expect(clientIp("127.0.0.1", "198.51.100.7", false)).toBe("127.0.0.1");
    expect(clientIp("::ffff:127.0.0.1", undefined, false)).toBe("127.0.0.1");
  });

  it("takes the right-most hop, which is the one our load balancer appended", () => {
    expect(clientIp("10.0.0.1", "198.51.100.7, 203.0.113.9", true)).toBe("203.0.113.9");
  });

  it("accepts a repeated header, as Node delivers it", () => {
    expect(clientIp("10.0.0.1", ["198.51.100.7", "203.0.113.9"], true)).toBe("203.0.113.9");
  });

  it("tolerates whitespace and empty list entries", () => {
    expect(clientIp("10.0.0.1", " 203.0.113.9 ,, ", true)).toBe("203.0.113.9");
  });

  it("falls back to the socket address when the header is blank", () => {
    expect(clientIp("10.0.0.1", "", true)).toBe("10.0.0.1");
    expect(clientIp("10.0.0.1", undefined, true)).toBe("10.0.0.1");
  });

  it("normalizes the forwarded IPv4-mapped form as well", () => {
    expect(clientIp("10.0.0.1", "::ffff:203.0.113.9", true)).toBe("203.0.113.9");
  });
});

describe("isOriginAllowed", () => {
  const allowed = ["https://freecall.example", "http://localhost:3000"];

  it("accepts an allowlisted origin", () => {
    expect(isOriginAllowed("https://freecall.example", allowed)).toBe(true);
  });

  it("tolerates a trailing slash", () => {
    expect(isOriginAllowed("https://freecall.example/", allowed)).toBe(true);
  });

  it("rejects a lookalike origin", () => {
    expect(isOriginAllowed("https://freecall.example.evil", allowed)).toBe(false);
    expect(isOriginAllowed("http://freecall.example", allowed)).toBe(false);
  });

  it("rejects the opaque null origin that sandboxed frames send", () => {
    expect(isOriginAllowed("null", allowed)).toBe(false);
  });

  it("allows a missing origin, because native clients do not send one", () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
    expect(isOriginAllowed("", allowed)).toBe(true);
  });
});
