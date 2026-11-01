# Contributing to freecall

This is a proprietary project. External contributions are by invitation only.
The guidelines below apply to all team members.

## Ground rules

1. **Safety first.** Any PR that touches the age gate, matchmaking auth path, CSAM
   escalation, or ban engine requires two reviewer approvals from the safety team.
2. **No new `any`.** TypeScript `any` and `@ts-ignore` are blocked by the lint config.
3. **No unvalidated external input.** Every new API route must validate its body with zod.
4. **No hardcoded secrets.** The CI secret scan blocks merges that contain API keys or tokens.
5. **DB migrations are reviewed separately.** Every schema change needs an expand/contract plan.
6. **Every new external call needs a timeout and a retry policy.** No fire-and-forget.
7. **i18n first.** No hardcoded copy — all user-visible strings go through `packages/i18n`.

## Local setup

```bash
# Prerequisites: Node 24+, Docker
git clone <repo>
cd freecall
npm ci
docker compose -f infra/docker/docker-compose.yml up -d
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000`.

## Running tests

```bash
npm test              # all unit tests via Vitest
npm run typecheck     # TypeScript across all packages
npm run lint          # ESLint
npm run format:check  # Prettier
```

## Branch naming

```
feat/short-description
fix/issue-description
chore/task-description
safety/critical-fix
```

## Commit messages

Follow Conventional Commits: `type(scope): description`.
Examples: `feat(matchmaking): add neighbour-region widening`, `fix(auth): validate jti on replay`.

## PR checklist

- [ ] `npm run typecheck && npm run lint && npm test` pass locally.
- [ ] Any new user-visible string is in `packages/i18n`.
- [ ] Any new DB table has a migration, index review, and retention classification.
- [ ] Any new external call has a timeout.
- [ ] Safety-sensitive paths have two approvals.
