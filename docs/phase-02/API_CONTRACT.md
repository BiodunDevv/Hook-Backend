# Phase 2 API Contract

## Envelopes

Success:

```json
{"success":true,"data":{},"meta":{"requestId":"uuid","timestamp":"ISO-8601"}}
```

Error:

```json
{"success":false,"error":{"code":"SCOPE_DENIED","message":"..."},"meta":{"requestId":"uuid","timestamp":"ISO-8601"}}
```

Pagination is returned in `meta.pagination`. Stable error families are validation, authentication, invalid token, access, scope, not found, conflict, transition, rate limiting, and internal error.

## Headers

- `Authorization: Bearer <access-token>` for accounts.
- `X-Guest-Session: <opaque-token>` for guests.
- `X-Hook-State-Id` and `X-Hook-Hub-Id` are optional staff context requests. They never grant scope.
- `X-Request-Id` may be supplied by a caller and is echoed.

## Main Phase 2 groups

- `/api/v1/guest-sessions`
- `/api/v1/public/states|cities|zones|markets`
- `/api/v1/admin/staff|roles|permissions`
- `/api/v1/admin/states|cities|zones`
- `/api/v1/admin/markets|hubs|partners|market-associates|market-associate-assignments`
- `/api/v1/admin/audit-logs|public-id-counters`
- `/api/v1/market-associate/profile|markets`
- `/api/v1/partner/profile|location`
- `/api/v1/auth/login` for customer, staff, Market Associate, and Partner identities

The generated `swagger-spec.json` is the detailed catalogue.
