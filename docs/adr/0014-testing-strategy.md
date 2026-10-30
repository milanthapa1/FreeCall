# ADR-0014 — Testing strategy: deterministic simulator, fakes over mocks, no real abuse data

- Status: accepted
- Date: 2026-10-30

## Context

The risky parts of this system are concurrency (matching), adversarial input (protocol, text,
uploads), and safety decisions (moderation, bans, CSAM). Unit tests with mocks prove little
about any of those. Load claims ("50k matches/s") are meaningless without a reproducible harness.

## Decision

- **Unit (Vitest)**: pure domain logic in `packages/core` — matching policy, widening, trust
  bands, ban escalation, ledger arithmetic, age state machine. Property-based tests
  (`fast-check`) for invariants: a pair is never both-blocked; balance equals sum of deltas;
  no ban transition loses an intermediate state.
- **Lua**: executed against a real Redis in CI (docker service), never mocked. Each script has
  table-driven cases including failover replay and clock skew.
- **Contract**: `packages/protocol` snapshot tests; every fixture is validated against both
  server and client direction schemas; a "breaking change detector" diffs the generated JSON
  Schema against `main` and fails on non-additive changes without a `v` bump.
- **Integration**: real Postgres + Redis + LiveKit (docker). Provider adapters tested against
  recorded fixtures and a local fake server, plus a nightly sandbox run against the vendor's
  test environment.
- **E2E (Playwright)**: Chromium with `--use-fake-device-for-media-stream` and a generated Y4M
  fixture; two browser contexts match, chat, skip, report, get banned. Accessibility via
  `@axe-core/playwright`; reduced-motion and keyboard-only paths are explicit specs.
- **Load (k6)**: deterministic simulator with a seeded RNG that models arrival rate, call
  duration distribution, country/language mix, block graph and trust distribution. It emits
  TTM histograms and invariant violations as custom metrics; CI runs a 10-minute smoke, staging
  runs the 50k/s proof with pinned hardware.
- **Chaos**: Redis primary kill, network partition, LiveKit region blackhole, Postgres failover,
  clock skew. Each has a runbook and an automated assertion (e.g. "no duplicate pairing").
- **Safety fixtures**: synthetic, clearly-labelled corpus. **No real CSAM, ever** — the CSAM
  adapter is tested with hashes of synthetic files and a fake provider that returns a match.
  Any accidental real material triggers the incident runbook.
- **Test data**: `packages/testing` factories with fixed seeds; no production data in
  non-production environments; the seed script is deterministic.

## Consequences

Positive: claims are reproducible, safety regressions are caught, on-call has rehearsed failure
modes. Negative: CI needs service containers (slower), simulator requires maintenance as the
matching policy evolves, and property tests need careful generators to avoid flakiness.

## Alternatives rejected

- **Mock Redis/mocks everywhere**: would hide exactly the bugs that matter.
- **Only E2E**: slow, flaky, cannot prove throughput invariants.
- **Production traffic replay**: privacy and safety violations; synthetic only.

## Revisit trigger

Flaky test rate > 2% for two weeks, or CI duration > 25 minutes.
