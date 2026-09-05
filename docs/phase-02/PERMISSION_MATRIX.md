# Phase 2 Endpoint And Permission Matrix

This matrix is the reviewed authorization contract for the Phase 2 platform routes mounted below `/api/v1/admin`. Authentication, staff account type, live Role resolution, and validated State/Hub context run before every entry below.

| Domain | Read permission | Mutation permission | Scope enforcement |
| --- | --- | --- | --- |
| Permissions | Staff authentication | `roles.manage` for role assignment | Global governance |
| Roles | Staff authentication | `roles.manage` | Global governance |
| Staff | `staff.view` | `staff.create`, `staff.edit`, `staff.suspend`, `staff.revoke_sessions` | Staff State and Hub assignments |
| Operation States | `states.view` | `states.manage` | Global or assigned State |
| Operation Cities | `cities.view` | `cities.manage` | Parent State |
| Service Zones | `zones.view` | `zones.manage` | Parent State |
| Markets | `markets.view` | `markets.manage`, `markets.assign_hub` | State and preferred Hub |
| Dispatch Hubs | `hubs.view` | `hubs.manage`, `hubs.assign_markets` | State and Hub |
| Hook Partners | `partners.view` | `partners.manage` | Partner State; Partner portal is self-only |
| Market Associates | `runners.view` | `runners.manage`, `runners.assign` | Any intersecting Market Associate State; Market Associate portal is self-only |
| Market Associate assignments | `runners.assign` | `runners.assign` | Market State and preferred Hub |
| Audit records | `audit.view` | No update/delete route | Requester's authorized scope |
| Public-ID counters | Super Admin | Super Admin with mandatory reason | Global governance |

## Lifecycle Routes

| Route pattern | Permission | Required control |
| --- | --- | --- |
| `POST /staff/:id/suspend` | `staff.suspend` | Reason, session-family revocation, audit |
| `POST /staff/:id/reactivate` | `staff.suspend` | Reason and audit |
| `POST /staff/:id/revoke-sessions` | `staff.revoke_sessions` | Reason and audit |
| `POST /staff/:id/resend-invitation` | `staff.create` | Invited status; previous token revoked |
| `POST /staff/:id/cancel-invitation` | `staff.suspend` | Invited status, reason, token revocation, account disable, audit |
| `POST /partners/:id/{activate,suspend,reactivate}` | `partners.manage` | Reason, scope, session revocation on suspension, audit |
| `POST /partners/:id/{resend-invitation,cancel-invitation}` | `partners.manage` | Invited status; cancellation requires reason |
| `POST /runners/:id/{activate,suspend,reactivate}` | `runners.manage` | Reason, scope, session revocation on suspension, audit |
| `POST /runners/:id/{resend-invitation,cancel-invitation}` | `runners.manage` | Invited status; cancellation requires reason |
| `POST /{states,cities,zones,markets,hubs}/:id/{activate,deactivate}` | Domain `manage` permission | Reason, relationship scope, audit |
| `POST /runner-assignments/:id/{activate,pause,end}` | `runners.assign` | Reason, compatible State/Hub, history and audit |

## Role Evaluation

- `SUPER_ADMIN` bypasses individual permission-key checks but not authentication, account status, or route validation.
- Other roles are evaluated from active Role records on every authenticated request. Token claims do not freeze permissions.
- State and Hub headers are context requests, not grants. `platformContext` rejects an unauthorized context before controllers execute.
- Market Associate and Partner routers require their exact account type and resolve only the authenticated profile.

## Findings

- Phase 2 platform routes use the matrix above consistently.
- Retained commerce routes use the same persisted Permission and Role catalogue as Phase 2 platform routes. Legacy `admin` and `support` enum values are identity compatibility fields only and do not grant authorization.
- The configured catalogue contains 45 active permissions across platform governance, operational network, retained orders/catalog/customers, finance, support, reports, analytics, and settings.
- Route order intentionally mounts the Phase 2 platform router before retained admin controllers. Identical paths such as `/staff` resolve to the Phase 2 implementation.
