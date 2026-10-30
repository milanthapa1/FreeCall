# ADR-0009 — Evidence in private R2 with legal hold and two-person break-glass

- Status: accepted
- Date: 2026-10-30

## Context

Reports and automated detections need durable, tamper-evident evidence for moderation,
appeals, law enforcement and NCMEC reporting. Evidence is the highest-risk data we hold: it can
contain nudity, minors, or criminal material. It must not be reachable by URL guessing, by a
compromised moderator account, or by a support tool.

## Decision

- **Bucket**: Cloudflare R2, private, no public domain, SSE at rest, TLS only, object lock for
  legal-hold items, lifecycle rules enforced by bucket policy, access via presigned GET with
  ≤5-minute TTL minted only by the worker.
- **Layout**: `evidence/{yyyy}/{mm}/{case_id}/{artifact}` with a manifest
  (`manifest.json`: sha256 per artifact, capture times, participants as opaque refs, model
  versions, report id). The manifest hash is stored in Postgres so tampering is detectable.
- **Write path**: presigned POST from the client is scoped to a single artifact key + content
  length + content type, expires in 2 minutes, and is single-use (the worker marks the key
  consumed). Worker verifies size, MIME by magic bytes, strips EXIF, re-hashes, then classifies.
- **Access**: three distinct roles.
  - `moderator`: sees derivative images (blurred, downscaled, watermarked with case id and
    timestamp) through the console proxy. Never a direct R2 URL.
  - `senior_reviewer`: can reveal unblurred derivatives, per item, time-boxed (5 min), reason
    required, audited.
  - `legal_hold`: raw objects, break-glass with two approvers, session recorded, no download.
    CSAM-suspect objects are **never** opened in-product; only hash metadata and the provider
    report are shown.
- **Retention** (final numbers pending legal sign-off, see `privacy.md`):
  - unattached automated frames: 7 days;
  - case evidence: 30 days after case closure (90 days if a ban is appealed);
  - CSAM-suspect: preserved indefinitely under legal hold in a segregated prefix, access only
    by the legal workflow, never deleted by routine jobs.
- **Deletion**: routine lifecycle deletion plus a nightly reconciliation that asserts no
  object exists without a case or hold flag. Deletion is logged with counts, not contents.
- **Integrity**: every write appends to `audit_logs` and emits an OTel event; manifests are
  re-verified weekly against stored hashes.

## Consequences

Positive: blast-radius containment, verifiable chain of custody, cheap storage, no egress bill
from Cloudflare R2. Negative: presigned uploads add a failure mode (client uploads but report
never lands) — handled by a `evidence_pending` case state with 24h retry; two-person break-glass
adds operational friction to genuine legal requests.

## Alternatives rejected

- **Store in Postgres (bytea)**: bloats backups, complicates retention, no object lock.
- **S3 with public-read signed URLs**: same capability, but R2 has no egress fees and we already
  use Cloudflare at the edge; S3 stays as the DR replica target.
- **Send evidence to the moderation vendor as the system of record**: vendors are processors,
  not custodians; their retention is not ours to defend.

## Revisit trigger

A regulator or law-enforcement partner requires a specific storage jurisdiction, or R2 object
lock semantics prove insufficient for the legal-hold workflow.
