# ADR-0001 — Turborepo monorepo on npm workspaces

- Status: accepted (Phase 0)
- Date: 2026-10-30

## Context

Web, realtime signaling, background workers and the moderator console share a domain model,
a wire protocol and a provider layer. Splitting them into separate repos would force versioned
package publishing or vendoring for changes that are frequently atomic (a protocol field plus
its producer and consumer). The team is small and the launch timeline is measured in months.
The toolchain is npm: pnpm must not be assumed available, and a single lockfile keeps CI and
Windows developer machines identical.

## Decision

One repository, npm workspaces, Turborepo for the task graph and caching.

- `package-lock.json` is committed; CI uses `npm ci`.
- Workspace dependencies use `"@freecall/protocol": "*"` (npm workspaces links locally).
- Turborepo owns `build`, `typecheck`, `lint`, `test`, `test:e2e`, with `dependsOn: ["^build"]`.
- Package scope `@freecall/*` is a working name; renaming is one codemod over `package.json`
  names and imports, executed when the brand is fixed.
- Apps are independently deployable artifacts. Shared packages are source-only (no build step
  beyond TS project references) to avoid a publish pipeline for internal code.
- Node version pinned in `.nvmrc` and `engines` (24.x LTS). Local Node 26 is tolerated for
  tooling, but realtime uses the pinned version in Docker because of native addons.

## Consequences

Positive: atomic changes across protocol/consumer, one lockfile, one CI, cheap code sharing,
fast onboarding. Negative: workspace hoisting can hide missing dependencies (mitigated by
`no-hoist`-style lint via `depcheck` in CI per workspace); Turborepo adds a cache to debug;
npm workspaces have weaker filtering ergonomics than pnpm (`npm run x -w <pkg>`).

## Alternatives rejected

- **Polyrepo**: correct at 50+ engineers, wrong at this size; protocol drift is the dominant risk.
- **pnpm**: faster and stricter, but unavailable in the target environments and not worth the
  operator friction.
- **Nx**: heavier than needed; we do not need generators or its graph UI.

## Revisit trigger

More than ~15 engineers, or a second product sharing packages, or a compliance requirement to
isolate the admin console into its own deployable repository with separate access control.
