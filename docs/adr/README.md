# ADR index

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-monorepo-npm-workspaces.md) | Turborepo monorepo on npm workspaces | accepted |
| [0002](0002-realtime-runtime.md) | Realtime service: Node 24 LTS + uWebSockets.js (Go fallback) | accepted |
| [0003](0003-redis-lua-matching.md) | Redis Cluster, sharded queues, Lua matching | accepted |
| [0004](0004-livekit-sfu.md) | LiveKit SFU only, no P2P media | accepted |
| [0005](0005-postgres-drizzle.md) | Neon Postgres + Drizzle, no DB on the match path | accepted |
| [0006](0006-age-assurance-tiers.md) | Server-authoritative age assurance with risk tiers | accepted |
| [0007](0007-better-auth-guests.md) | Better Auth, anonymous guests, in-place upgrade | accepted |
| [0008](0008-tiered-frame-sampling.md) | Tiered frame sampling, client frames are advisory | accepted |
| [0009](0009-evidence-storage.md) | Private R2 evidence, legal hold, two-person break-glass | accepted |
| [0010](0010-stripe-coin-ledger.md) | Stripe + append-only coin ledger with idempotency | accepted |
| [0011](0011-zod-protocol.md) | Zod-first versioned protocol, strict on the wire | accepted |
| [0012](0012-observability.md) | Privacy-safe observability | accepted |
| [0013](0013-multi-region-drain.md) | Multi-region realtime, sticky routing, 120s drain | accepted |
| [0014](0014-testing-strategy.md) | Deterministic simulator, fakes over mocks, no real abuse data | accepted |
| [0015](0015-fail-closed-safety.md) | Safety actions fail closed, single policy engine, provenance | accepted |
| [0016](0016-admin-console-isolation.md) | Admin console in web, isolated route group, server RBAC | accepted |
| [0017](0017-product-scope-safety-first.md) | Product scope: safety before surface area | proposed |

Open ADRs (not yet written, blocked on a decision):

- 0018 — Regional launch policy packs and age-assurance tiers per market (blocked: market list).
- 0019 — Translation provider and per-message translation retention (Phase 2).
- 0020 — Managed LiveKit vs self-hosted (Phase 5, cost-driven).
