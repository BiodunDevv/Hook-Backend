# Phase 2 Architecture

## Authority

`Hook-Backend` is the authority for identity, sessions, permissions, scope, geography, operational relationships, public IDs, and audits. Admin and Shopper clients display backend decisions; they do not infer authorization.

## Domains

- Identity: `User` credentials plus typed customer, staff, runner, and partner accounts.
- Sessions: independently revocable account sessions and opaque guest sessions.
- Access: live Role and Permission records resolved on every protected request.
- Geography: Operation State, Operation City, and Service Zone.
- Network: Market, Dispatch Hub, Hook Partner, Runner Profile, and Runner Market Assignment.
- Governance: atomic annual public-ID counters and append-only sanitized audit events.

Legacy User roles and legacy collections remain compatibility inputs only. No Vendor, Booth, or Driver model was renamed destructively.

## API boundary

All `/api/v1` responses use `{ success, data, meta }` or `{ success, error, meta }`. `meta.requestId` matches `X-Request-Id`. Public Hook IDs are accepted at resource boundaries and preferred in client-visible records.

## Applications

- Admin: one permission-aware staff application in `app/(admin)/dashboard`. Super Admin is an RBAC role, not a duplicated dashboard tree.
- Runner: isolated `app/(runner)/runner` route group, preserving `/runner/*` URLs, with server-enforced Runner login and session guard.
- Partner: isolated `app/(partner)/partner` route group, preserving `/partner/*` URLs, with server-enforced Partner login and session guard.
- Shopper: customer authentication, backend-issued guest sessions, and public geography.

Commerce behavior remains out of Phase 2.
