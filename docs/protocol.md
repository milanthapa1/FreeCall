# Realtime protocol v1

Single source of truth: `packages/protocol`. Every message in both directions is parsed by a
`.strict()` zod schema. This document describes semantics; the schemas are normative.

## 1. Transport and auth

- `wss://rt-{region}.{domain}/v1?token=<jwt>` — the token is also sent in `hello` so it can be
  validated after connect (query strings leak into logs; the edge strips them, and the socket
  URL is not logged).
- JWT (EdDSA, 60s TTL) claims: `sub` (user id), `sid` (session id), `aud: "rt"`, `jti`,
  `age_tier`, `trust_band`, `market`, `region`, `ent`, `iat`, `exp`. Verified against a cached
  JWKS; no DB call per connect.
- Unknown/expired/`aud` mismatch → close `4001 unauthorized`. Banned/locked → close `4003`.
  Unsupported `v` → `4002`.
- One logical connection per user; a second connection replaces the first with `session_replaced`
  (close `4004`) unless the first is `draining`.
- Max frame 16KB; binary frames rejected. Idle without `ping` for 45s → close `4000`.

## 2. Envelope

```ts
{
  v: 1,
  type: "chat",
  id: "01J...",        // client-generated uuid v7, echoed in ack
  seq: 42,             // per-connection, strictly increasing, optional for server events
  ts: 1761780000000,   // client clock, advisory only
  data: { ... }        // typed per event
}
```

Server uses `ts` from its own clock for ordering; client `ts` is used only for latency metrics
and is never trusted for authorization or cooldowns.

## 3. Events

### Client → server

| Event | Data | Limits | Notes |
|---|---|---|---|
| `hello` | `token`, `client{platform, version, locale}`, `resume_call_id?` | 1 per connection | Must be first; anything else closes `4005`. |
| `ping` | `{}` | 1/5s | Server replies `pong` with `server_time`; drives RTT indicator. |
| `enqueue` | `{country: "any"|ISO2, mode: "solo"|"couple", lang: ISO2, own_gender?: "m"|"f"|"x", strict_gender: boolean}` | 1 active queue entry | Server clamps to session capabilities; client values are preferences only. |
| `skip` | `{call_id, reason: "next"|"inappropriate"}` | 1/2s | Ends call, requeues self. `inappropriate` also creates a soft report signal. |
| `stop` | `{call_id}` | idempotent | Ends call, does not requeue. |
| `chat` | `{call_id, body, client_msg_id, translate_to?}` | 1/s, 5/10s burst; body ≤500 chars | Rejected when not `in_call`. |
| `typing` | `{call_id, state: "start"|"stop"}` | 1/s | Dropped silently above limit. |
| `read_receipt` | `{call_id, up_to_seq}` | 1/s | Phase 4 only. |
| `report` | `{call_id, reason, note?, client_msg_ids: string[], frame_upload_id?}` | 1 per call | Server pulls the last 50 messages from its own buffer; client ids are a cross-check, not the source. |
| `joined` | `{call_id, room_sid?}` | once per call | Starts the 8s connect window. |
| `leave` | `{call_id}` | idempotent | User closed the tab; same as `stop`. |
| `offer` / `answer` / `ice` | SDP/candidate | — | **Rejected with `unsupported_event` in v1** (SFU-only, ADR-0004). Reserved for voice-only/P2P experiments. |

### Server → client

| Event | Data | When |
|---|---|---|
| `hello_ok` | `{user_id, session_id, server_time, limits, features, resume: {call_id, room_token}?}` | After auth; `resume` lets a reconnecting client rejoin the same room. |
| `queued` | `{position_band: "short"|"medium"|"long", widening_step, enqueued_at}` | Position is banded — never an exact number. |
| `matched` | `{call_id, room, room_token, expires_at, partner: {country, lang, mode, band, age_tier}, connect_deadline_ms}` | Both sides, same tick. No PII, no exact location, no profile. |
| `call_connected` | `{call_id, connected_at}` | Both joined; call active. |
| `call_ended` | `{call_id, end_reason, requeued: boolean}` | Skip/stop/partner left/enforcement. |
| `partner_left` | `{call_id, reason, reconnect_grace_ms}` | Partner socket dropped; may return. |
| `chat` | `{call_id, message_id, sender: "you"|"partner", body, translated_from?, sent_at}` | Delivery/echo. |
| `chat_ack` | `{client_msg_id, message_id, status: "delivered"|"blocked", code?}` | After moderation. |
| `typing` | `{call_id, state}` | Relayed, never stored. |
| `report_ack` | `{report_id, status: "accepted"|"duplicate", evidence: "pending"|"received"}` | Within 1s. |
| `warning` | `{code, message_key, policy_url}` | Rate limits, camera-off reminders, community rules nudge. |
| `ban` | `{scope, reason_code, expires_at, appeal_url}` | Enforcement; socket closes `4003` after delivery. |
| `draining` | `{retry_after_ms, region}` | Before a deploy or region evacuation; client reconnects with jitter and `resume_call_id`. |
| `requeue_required` | `{reason: "failover"|"region_unavailable"}` | Redis/region failure; client re-enqueues automatically once. |
| `error` | `{code, message_key, retryable, correlation_id}` | Protocol/validation/state errors. |
| `pong` | `{server_time}` | Reply to `ping`. |

## 4. State machine

```
connecting ──hello──► ready ──enqueue──► queued ──matched──► matched
                                            ▲                  │ joined (both)
                                            │                  ▼
                                            └──requeue──────── connected ──► in_call
                                                                             │ skip/stop/end
                                                                             ▼
                                                                           ready
```

Server rejects any event not valid in the current state with `error{code:"invalid_state"}`.
`matched` has its own 8s deadline: no `joined` from either side → `call_failed` + requeue.

## 5. Chat and translation

- Bodies are normalized and moderated **before** relay and before ack; a blocked message returns
  `chat_ack{status:"blocked", code:"text_policy"}` and is not delivered.
- The server keeps a per-call ring buffer of the last 50 delivered messages (in memory, max 16KB)
  purely for evidence on report. It is not persisted and is discarded when the call closes.
- `translate_to` is a per-message opt-in; the translated body is delivered as
  `translated_from` on the recipient's event only. Translation happens server-side, after
  moderation, with a 1.5s budget; on timeout the original is delivered with `translated_from`
  absent and no error is shown (graceful degradation).
- No images, files, links, or voice notes in in-call chat. Link-like content is rejected by the
  normalizer.

## 6. Rate limits and quotas

| Bucket | Limit | Enforcement |
|---|---|---|
| Messages (all types) | 8/s sustained, 20 burst per socket | Token bucket in Redis keyed by `sid` |
| `chat` | 1/s, 5 per 10s | Per socket + per call pair |
| `typing` | 1/s | Dropped above limit |
| `skip` | 1 per 2s | Cooldown error |
| `enqueue` | 1 per 3s | `already_enqueued` after first |
| `report` | 1 per call | `duplicate` ack on retry |
| Connections | 5 per user, 60 per IP per minute | Edge + realtime |
| Failed validation | 5 in 60s → close `4006` | Protects against fuzzers |

Limits are returned in `hello_ok.limits` so the client can pre-empt and show honest UI.

## 7. Error and close codes

| Code | Meaning |
|---|---|
| `4000` | idle timeout |
| `4001` | unauthorized / expired token |
| `4002` | unsupported protocol version |
| `4003` | banned or locked |
| `4004` | session replaced by a newer connection |
| `4005` | protocol violation (event before hello, binary frame) |
| `4006` | repeated invalid frames |
| `4007` | server draining / region unavailable |
| `4100` | invalid_state |
| `4101` | rate_limited |
| `4102` | age_required |
| `4103` | cap_exceeded (guest time limit) |
| `4104` | already_enqueued / already_in_call |
| `4105` | unsupported_event |
| `4106` | payload_too_large |

Errors always carry a stable `code`, a `message_key` resolvable by the client's i18n bundle, and
a `correlation_id` that appears in server logs and traces.

## 8. Versioning

- Additive optional fields: minor change, no `v` bump, clients must ignore what they do not know
  — except the zod parser rejects unknown fields, so additive fields are only safe when the
  schema is deployed to both sides in the same release. For cross-version safety the server
  accepts `v: 1` and `v: 2` envelopes during a 30-day window and validates against the matching
  schema; the client buffer of events is versioned with the connection.
- Breaking change: bump `v`, keep `v-1` for 30 days, emit `warning{code:"deprecated_protocol"}`
  to old clients, and alert if `v-1` traffic is > 1% at the end of the window.
- A breaking-change detector diffs the generated JSON Schema in CI and fails the PR unless the
  version was bumped and a migration note was added.

## 9. Test obligations

- Table-driven contract tests: every event, valid/invalid/unknown-field/oversize cases.
- Fuzz: 10k random JSON frames per CI run must never throw or close the socket before 5
  violations.
- Two-client Playwright test using the real protocol package, plus a compatibility job that
  runs the previous release's client against the current server.
