# Runbook: CSAM / minors-risk escalation

**Trigger:** `csam_hash_match` signal, `minor_presence` above the auto-action threshold, or a
credible report that a participant is a minor.
**Do not** open, download, copy, screen-record or forward any suspected material. Ever.

## Roles

| Role | Responsibility |
|---|---|
| On-call safety lead | Owns the incident, acknowledges within 15 min, coordinates |
| Senior reviewer | Confirms/rejects the automated match from metadata only |
| Legal / ESP point of contact | Files the NCMEC CyberTipline report, handles law enforcement |
| Security on-call | Contains account/device, checks for further sessions |
| DPO | Records the incident, assesses notification duties |

## 1. Automated containment (already done at t+0)

- Call ended, subject locked, all sessions revoked, enqueue blocked.
- Evidence written to `evidence/restricted/...` with object lock + legal hold; manifest hash in
  Postgres; no route serves it.
- Case created `severity=critical, status=escalated`; PagerDuty high-urgency page sent.

**Verify, do not repeat:** confirm the case exists, the lock is applied, and the evidence object
is in the restricted prefix. If any step failed, treat it as SEV1 and fix containment before
anything else.

## 2. Confirmation (t+0 → t+15 min)

1. Senior reviewer opens the case. They may see: hash metadata, provider confidence, model
   version, market, account age, device/IP risk summary, chat transcript, and the *blurred*
   derivative if policy allows. They may **not** reveal or open the suspected object.
2. Decision: **confirm** or **reject**.
   - Confirm → step 3. Keep the account locked.
   - Reject → unlock, record the false positive with reason, notify Legal that no report will be
     filed, and file a model-feedback record. If there is any doubt, escalate to Legal instead of
     rejecting.
3. Notify Legal and Security immediately (PagerDuty + direct message). Do not wait for the
   weekly report.

## 3. Reporting (t+15 min → t+1h)

1. Legal confirms the reporting obligation for the market. In the US, an electronic service
   provider must report apparent CSAM to NCMEC's CyberTipline; other markets may require a
   national authority or both. The market policy pack names the authority and the form.
2. Legal files the report with: incident time, account/subscriber information required by law,
   the preserved file identifiers, and the provider/hash source. **Legal files it — engineering
   does not.**
3. Preservation: retain the object and associated records for at least the statutory minimum
   (90 days in the US) and longer if requested by NCMEC or law enforcement. Object lock prevents
   deletion; do not lift it.

## 4. Law enforcement (any time)

- All requests go to Legal. Engineering does not respond directly, even to a valid-looking
  subpoena.
- Preservation first (freeze the data), disclosure only after legal review, minimum necessary.
- Log in `legal_requests` with requester, scope, authority, what was disclosed, and who approved.

## 5. Further containment

- Search for other sessions/devices on the subject (`devices`, `ip_reputation`, `calls`).
- If other accounts share the device fingerprint, flag them for review — do not auto-ban on
  fingerprint alone.
- Check whether the partner in the call needs support resources and whether their session
  captured anything (no recording exists; confirm).
- If the material may have been seen by a moderator or engineer, trigger the exposure runbook:
  stop, notify DPO/Security, do not review again, offer EAP.

## 6. Closure

- Keep the account locked unless Legal explicitly clears it.
- Appeal, if filed, is decided by Legal, not moderators.
- Post-incident review within 5 business days: detection latency, containment, reporting
  timeliness, model performance, and whether any policy or threshold should change.
- Update the weekly report and the risk register. Never include suspected material or a
  description of its content in any report, ticket or chat.

## Prohibited

- Viewing, downloading, copying, re-uploading or describing the suspected material.
- Deleting the object, lifting the hold, or "cleaning up" the case.
- Discussing the case in general channels; use the restricted incident channel.
- Waiting for a second confirmation before notifying Legal.
