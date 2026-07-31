# Active System Map After Phase 2

## Backend

Express request context -> authentication/session validation -> live RBAC -> state/Hub policy -> domain controller/service -> Mongoose model -> append-only audit.

## Admin

The source lives under `app/(admin)/dashboard`; public URLs remain `/dashboard/*`. It retains valid operations surfaces and adds Administration, Markets, Hubs, Partners, and Runners. State and Hub selectors send requested context headers. Staff roles share this shell and receive permission-aware navigation.

## Runner

Source lives under `app/(runner)/runner`. `/runner/login`, dashboard, assigned Markets, profile, and security use a Runner-only backend login and account-type guard.

## Partner

Source lives under `app/(partner)/partner`. `/partner/login`, dashboard, profile, location, and security use a Partner-only backend login and account-type guard.

## Shopper

Customer auth/session restore, opaque guest sessions, and public State/City/Zone/Market queries. Phase 3 commerce remains unchanged and out of scope.
