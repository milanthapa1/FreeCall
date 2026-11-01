# Security Policy

## Supported Versions

Only the latest release branch (`main`) receives security patches. Staging and development
branches may lag behind; never expose them publicly.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Email **security@freecall.app** with:

1. A description of the vulnerability.
2. Steps to reproduce (curl commands, PoC code, screenshots).
3. The impact you believe this has.
4. Your PGP public key if you want an encrypted response.

We will acknowledge your report within **48 hours** and aim to provide a fix timeline
within **7 business days** for critical issues. We follow coordinated disclosure:
we will credit you in the release notes unless you prefer to remain anonymous.

## Scope

| In scope | Out of scope |
|---|---|
| Authentication bypass | Social engineering |
| Age-gate bypass | Clickjacking on pages with no sensitive actions |
| CSAM / minor-safety path bypass | Rate limiting precision |
| SQL injection or RCE | Theoretical attacks without a PoC |
| PII exposure | Scanner output without manual verification |
| Privilege escalation in admin console | |

## Security Controls Summary

See [`docs/security.md`](docs/security.md) for the full threat model and control inventory.

- JWT tokens are short-lived (5 minutes for realtime connections).
- All secrets are validated at process boot; malformed or placeholder values cause exit.
- No client-supplied value influences the resolved market — geo is server-side only.
- Report evidence is stored in a private, access-controlled bucket.
- Every automated enforcement action is logged with model, version, score, and policy version.
- CSAM signals trigger immediate escalation with no threshold gate.
