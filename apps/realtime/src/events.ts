import { PROTOCOL_VERSION, type ServerEvent, type ServerEventType } from "@freecall/protocol";
import { randomUUID } from "node:crypto";

/**
 * Builds a server event envelope. `type` and `data` are correlated by the protocol union at
 * the call site, so a payload that does not belong to the event type is a type error.
 */
export function createServerEvent<T extends ServerEventType>(
  type: T,
  data: Extract<ServerEvent, { type: T }>["data"],
  now: () => number = Date.now,
): ServerEvent {
  return {
    v: PROTOCOL_VERSION,
    type,
    id: randomUUID(),
    ts: now(),
    data,
  } as ServerEvent;
}
