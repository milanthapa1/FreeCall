# Runbook: realtime deploy drain

**Trigger:** routine deploy, hotfix, or capacity scale-down of `apps/realtime`.
**Impact if done wrong:** dropped sockets, users mid-call lose signaling (media survives briefly),
partners see a frozen video.

## Preconditions

- Deploy is not during an active SEV1/SEV2 or a regional incident.
- `freecall.match.pop_ms` p95 and error rate are within SLO for the last 15 minutes.
- At least two healthy pods per region beyond the surge target.

## Procedure

1. Deploy with `maxSurge=25%`, `maxUnavailable=0`, one region at a time, starting with the
   lowest-traffic region. Wait for new pods to pass `/readyz` (`redis: ok`, `livekit: ok`,
   `jwks: ok`).
2. The orchestrator sends SIGTERM to an old pod. The pod immediately:
   - fails `/readyz` so the load balancer stops new connections,
   - answers `enqueue` with `error{code:"draining"}` (no new matches on this pod),
   - sends `draining{retry_after_ms}` to every connected socket with 2–10s jitter,
   - keeps serving `chat`, `typing`, `skip`, `stop` and `joined` for existing calls.
3. Clients reconnect to another pod, sending `resume_call_id`. If the LiveKit room is still
   alive, they rejoin it; otherwise they get `call_ended{reason:"partner_left"|"error"}`.
4. The pod waits until either no sockets remain or 120s elapse, then closes 1012.
5. Verify per region: `dropped_sessions_total` delta must be 0 among healthy clients,
   reconnect p95 < 5s, no spike in `call_ended{reason:"error"}`, no spike in reports.
6. Proceed to the next region. Stop and roll back if any region shows > 0.5% error rate or a
   reconnect p95 above 5s.

## Rollback

`fly deploy --image <previous>` (or the platform equivalent) to the affected region only.
Because draining is per-pod and the protocol is versioned, a mixed-version window of 30 days is
supported; a rollback does not require draining the new pods first.

## Post-checks

- Compare `matched` count per minute before/after: within ±5%.
- Confirm no queue entries reference dead pods (`presence` TTL handles it; verify depth returns
  to baseline within 60s).
- Attach the deploy id and the metric snapshots to the release note.

## Escalation

If reconnects do not converge in 10 minutes: page the platform on-call, consider region
evacuation (`feature_flags` kill switch) for the affected region, and communicate in the status
channel. Do not attempt a second deploy while the first is unresolved.
