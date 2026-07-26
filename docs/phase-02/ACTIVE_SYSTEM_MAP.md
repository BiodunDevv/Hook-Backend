# Active System Map After Phase 2

## Backend

Express request context -> authentication/session validation -> live RBAC -> state/Hub policy -> domain controller/service -> Mongoose model -> append-only audit.

## Admin

`/dashboard` retains valid operations surfaces. Phase 2 adds `/dashboard/administration`, `/dashboard/markets`, `/dashboard/hubs`, `/dashboard/partners`, and `/dashboard/runners`. State and Hub selectors send requested context headers.

## Runner

`/runner/login`, dashboard, assigned Markets, profile, and security. Data comes from self-scoped Runner endpoints.

## Partner

`/partner/login`, dashboard, profile, location, and security. Data comes from self-scoped Partner endpoints.

## Shopper

Customer auth/session restore, opaque guest sessions, and public State/City/Zone/Market queries. Phase 3 commerce remains unchanged and out of scope.
