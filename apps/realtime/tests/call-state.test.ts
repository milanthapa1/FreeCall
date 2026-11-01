import { describe, expect, it } from "vitest";
import { CallStateManager } from "../src/call-state.js";

describe("CallStateManager", () => {
  it("creates, tracks, and ends a call", () => {
    const mgr = new CallStateManager();
    const callId = mgr.newCallId();
    expect(callId).toBeDefined();

    const record = mgr.createCall({
      callId,
      roomName: `call-${callId}`,
      sidA: "sid-alice",
      userIdA: "user-alice",
      sidB: "sid-bob",
      userIdB: "user-bob",
      matchedAt: 1000,
    });

    expect(record.status).toBe("setup");
    expect(mgr.size).toBe(1);
    expect(mgr.getCall(callId)).toBe(record);
    expect(mgr.getCallBySid("sid-alice")).toBe(record);
    expect(mgr.getCallBySid("sid-bob")).toBe(record);
    expect(mgr.getCallBySid("sid-charlie")).toBeUndefined();

    // Alice joins
    const bothJoined1 = mgr.recordJoin(callId, "sid-alice");
    expect(bothJoined1).toBe(false);

    // Bob joins
    const bothJoined2 = mgr.recordJoin(callId, "sid-bob");
    expect(bothJoined2).toBe(true);

    // Mark active
    mgr.markActive(callId, 1500);
    expect(mgr.getCall(callId)?.status).toBe("active");
    expect(mgr.getCall(callId)?.connectedAt).toBe(1500);

    // Record disconnect
    const partnerSid = mgr.recordDisconnect(callId, "sid-alice", 2000);
    expect(partnerSid).toBe("sid-bob");

    // End call
    const ended = mgr.endCall(callId);
    expect(ended).toBeDefined();
    expect(mgr.size).toBe(0);
    expect(mgr.getCall(callId)).toBeUndefined();
    expect(mgr.getCallBySid("sid-alice")).toBeUndefined();
  });

  it("rejects duplicate call creation for same sid", () => {
    const mgr = new CallStateManager();
    const call1 = mgr.newCallId();
    const call2 = mgr.newCallId();

    mgr.createCall({
      callId: call1,
      roomName: "room-1",
      sidA: "sid-1",
      userIdA: "user-1",
      sidB: "sid-2",
      userIdB: "user-2",
      matchedAt: 1000,
    });

    expect(() =>
      mgr.createCall({
        callId: call2,
        roomName: "room-2",
        sidA: "sid-1",
        userIdA: "user-1",
        sidB: "sid-3",
        userIdB: "user-3",
        matchedAt: 1001,
      }),
    ).toThrow(/already has an active call/);
  });
});
