# freecall (working name — brand TBD)

Adults-only random video chat. Original product, original copy, original assets.
No third-party branding is used anywhere in this repository.

**Status: Phase 2 complete. Phase 3 (safety/moderation) in progress.**
This repository contains a working implementation of the core product: landing page, age gate,
guest sessions, matchmaking, realtime video calls, chat, and the full moderation pipeline scaffolding.

## Read in this order

| # | Document | Why |
|---|---|---|
| 1 | [`docs/plan.md`](docs/plan.md) | Phases, deliverables, acceptance criteria, exit gates |
| 2 | [`docs/architecture.md`](docs/architecture.md) | Monorepo tree, runtime topology, capacity model, request flows |
| 3 | [`docs/adr/`](docs/adr) | The decisions everything else depends on |
| 4 | [`docs/risk-register.md`](docs/risk-register.md) | What can hurt users, the company, or the launch |
| 5 | [`docs/data-model.md`](docs/data-model.md) | Schema, indexes, retention, migration notes |
| 6 | [`docs/matchmaking.md`](docs/matchmaking.md) | Queue keys, Lua contract, widening, failover |
| 7 | [`docs/protocol.md`](docs/protocol.md) | Versioned realtime event schema and limits |
| 8 | [`docs/moderation.md`](docs/moderation.md) | Detection tiers, CSAM/NCMEC workflow, moderator console |
| 9 | [`docs/security.md`](docs/security.md) | Threat model, controls, pen-test checklist |
| 10 | [`docs/privacy.md`](docs/privacy.md) | Data inventory, retention matrix, DSAR/deletion |
| 11 | [`docs/slo.md`](docs/slo.md) | SLOs, error budgets, alerting |
| 12 | [`docs/runbooks/`](docs/runbooks) | Draining, Redis failover, CSAM escalation |

## Ground rules baked into this design

1. **No matchmaking without age assurance.** Age state is a server-side gate on the
   enqueue path, not a client flag. The required tier comes from a versioned per-market
   policy pack; an unknown or unsigned market is blocked, not default-allowed (ADR-0018).
   Guests get a capped, low-privilege tier.
2. **Safety is in the MVP critical path.** Frame sampling, text moderation, reporting,
   evidence capture, auto-bans, appeals and the moderator console are Phase 3, before
   any growth work.
3. **Minors-risk and CSAM findings fail closed**: disconnect, lock, preserve, escalate.
   Never "queue and continue".
4. **Secrets never reach the client.** Every app validates its environment with zod at
   boot and refuses to start when a required secret is absent or malformed.
5. **Every automated enforcement action is reproducible**: model, version, score,
   threshold, policy version, reviewer, appeal outcome.

## Layout (target)

```
apps/        web (Next.js 15), realtime (uWebSockets.js), worker (moderation/egress), admin is a route group in web
packages/    protocol, db, core, moderation, providers, auth, config, ui, i18n, observability, testing
infra/       terraform, docker-compose, k6
docs/        ADRs, designs, runbooks, reports
```

## Commands

Available once Phase 0 lands (see `docs/plan.md`):

```bash
npm ci                # or: npm install
npm run dev           # web + realtime + worker + docker services
npm test              # vitest (unit + contract)
npm run test:e2e      # playwright with fake media devices
npm run db:migrate    # drizzle-kit migrate
npm run lint && npm run typecheck
npm run load:match    # k6 matching scenario against local realtime
```

## Licence and content policy

Proprietary. All UI copy, illustrations, sounds and design tokens are authored in-repo.
Third-party dependencies are tracked in `docs/dependencies.md` (Phase 0) with licence and
security review notes.
