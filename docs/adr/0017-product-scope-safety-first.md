# Are we building the wrong thing?

- Status: proposed
- Date: 2026-10-30

## Context

Every other ADR assumes the product is wanted. This one questions it: anonymous random video
chat is a category with heavy abuse, thin margins, and high infrastructure cost per user. Features
that look like growth (guest start, DMs, coins) are also the features that most enlarge the safety
surface. The point of this document is to make the trade explicit rather than discover it during
an incident.

## Decision

We ship the MVP (age gate, matching, video, chat, report/block, auto-ban, moderator console)
before any social or monetization feature, and we treat the following as launch-blocking product
decisions rather than engineering details:

1. **Guest self-declaration is a limited tier, not a loophole.** 30 call-minutes/day, no DMs, no
   uploads. If conversion demands more, the answer is a different market or a different assurance
   tier, not a larger cap.
2. **Reports are the primary safety signal**, so the report flow is one tap, works when video is
   frozen, and never requires an account.
3. **No public creator economy in v1.** Coins buy convenience (priority, HD, extra filters), not
   visibility of other people. Paying to reach a specific person turns the product into a
   different, higher-risk business.
4. **No recording, no screenshots feature, no screen share.** Those capabilities are abuse
   multipliers and we do not need them to test demand.
5. **Ads are consent-gated and never adjacent to a stranger's video feed.** If ad revenue is
   required for the model to work, that is a business-model question to answer before Phase 5,
   not a UI slot to fill.

## Consequences

Positive: the riskiest surfaces are bounded by product decisions, not only by code. Negative: a
smaller feature set at launch; some growth experiments (e.g. "tip the person you just met") are
deliberately deferred and may be permanently off the table.

## Alternatives rejected

- **Ship everything and moderate later**: contradicts the brief and the category's history.
- **Accounts required to start**: safer identity, materially worse funnel; mitigated by the tier
  design instead.

## Revisit trigger

Post-launch data shows the guest tier converts acceptably *and* abuse rates stay within the
moderation SLO. Only then is expanding guest capabilities considered, with a safety review.
