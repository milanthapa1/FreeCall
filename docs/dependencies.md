# Dependency inventory

All runtime dependencies used in production, with licence, purpose, and security review notes.
Updated as part of Phase 0 and reviewed on each major version bump.

## Runtime dependencies

| Package | Version | Licence | Purpose | Security notes |
|---|---|---|---|---|
| `next` | 15.x | MIT | Web framework (RSC, routing, build) | Review release notes for middleware/SSRF changes |
| `react` / `react-dom` | 19.x | MIT | UI rendering | — |
| `ws` | 8.x | MIT | WebSocket server (realtime) | Per ADR-0002, replaces uWebSockets.js for Phase 2 |
| `ioredis` | 5.x | MIT | Redis client | Enable TLS in production; disable `enableOfflineQueue` in health probes |
| `drizzle-orm` | 0.x | Apache-2.0 | ORM | `prepare: false` mandatory for transaction-mode pooler |
| `postgres` (pg driver) | 3.x | BSD-2-Clause | Postgres driver for Drizzle | — |
| `jose` | 6.x | MIT | JWT sign/verify | Use EdDSA/RS256 in production; HS256 only in dev |
| `livekit-server-sdk` | 2.x | Apache-2.0 | LiveKit room/token management | API secret must be ≥32 chars |
| `livekit-client` | 2.x | Apache-2.0 | WebRTC client (browser) | — |
| `@aws-sdk/client-s3` | 3.x | Apache-2.0 | R2/S3 evidence storage | Credentials via env only |
| `bullmq` | 5.x | MIT | Job queues (worker) | Requires `maxRetriesPerRequest: null` for BullMQ workers |
| `zod` | 3.x | MIT | Schema validation | — |
| `clsx` | 2.x | MIT | CSS class merging | — |
| `tailwind-merge` | 3.x | MIT | Tailwind class deduplication | — |
| `i18n-iso-countries` | 7.x | MIT | ISO 3166-1 alpha-2 codes | Used only in DB seed |

## Dev-only dependencies

| Package | Licence | Purpose |
|---|---|---|
| `turbo` | MIT | Monorepo task orchestration |
| `typescript` | Apache-2.0 | Type checking |
| `eslint` + `typescript-eslint` | MIT / MIT | Linting |
| `prettier` | MIT | Formatting |
| `vitest` | MIT | Unit testing |
| `tsx` | MIT | TypeScript execution (dev) |
| `playwright` | Apache-2.0 | E2E testing (Phase 2+) |

## Licence compliance

All production dependencies use permissive licences (MIT, Apache-2.0, BSD). No GPL,
LGPL, or copyleft licences are used in the production bundle.

## Vulnerability monitoring

Dependabot is enabled on the repository. Critical CVEs must be patched within 7 days;
high CVEs within 30 days. `npm audit --audit-level=high` blocks CI on any unresolved high.
