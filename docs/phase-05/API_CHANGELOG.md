# Phase 5 API Changelog

## Market Associate

- `GET /api/v1/market-associate/fulfilments/dashboard`
- `GET /api/v1/market-associate/fulfilments`
- `GET /api/v1/market-associate/fulfilments/:id`
- `POST /api/v1/market-associate/fulfilments/:id/{accept|start_sourcing|secure|begin_packing|pack}`
- `POST /api/v1/market-associate/fulfilments/:id/issues`

## Admin

- `GET /api/v1/admin/fulfilment/control-tower`
- `GET /api/v1/admin/fulfilment/tasks/:id`
- `GET /api/v1/admin/fulfilment/market-associates`
- `GET /api/v1/admin/fulfilment/hubs`
- `POST /api/v1/admin/fulfilment/tasks/:id/reassign`
- `GET /api/v1/admin/fulfilment/exceptions`
- `PATCH /api/v1/admin/fulfilment/exceptions/:id`
- `GET /api/v1/admin/fulfilment/hub`
- `GET /api/v1/admin/fulfilment/consolidations`
- `POST /api/v1/admin/fulfilment/packages/:id/receive`
- `POST /api/v1/admin/fulfilment/packages/:id/qc`
- `POST /api/v1/admin/fulfilment/orders/:id/consolidate`
- `POST /api/v1/admin/fulfilment/consolidations/:id/seal`
- `GET /api/v1/admin/fulfilment/shipments`
- `GET /api/v1/admin/fulfilment/logistics/readiness`
- `POST /api/v1/admin/fulfilment/orders/:id/shipments`
- `PATCH /api/v1/admin/fulfilment/shipments/:id`
- `GET /api/v1/admin/fulfilment/returns`
- `PATCH /api/v1/admin/fulfilment/returns/:id/review`
- `GET /api/v1/admin/fulfilment/refunds`
- `POST /api/v1/admin/fulfilment/refunds`
- `POST /api/v1/admin/fulfilment/refunds/:id/process`

## Customer and Partner

- `GET /api/v1/orders/:id/fulfilment`
- `POST /api/v1/orders/:id/returns`
- `GET /api/v1/partner/fulfilment/custody`
- `GET /api/v1/partner/fulfilment/custody/:orderId`
- `POST /api/v1/partner/fulfilment/custody/:id/receive`
- `POST /api/v1/partner/fulfilment/custody/:id/release`

## Webhooks

- `POST /api/v1/webhooks/logistics/:provider` with `x-provider-event-id` and
  `x-provider-signature` (HMAC verification is required for enabled providers).

All sensitive mutations remain protected by account type, permission, State/Hub
scope, ownership checks, and version/idempotency validation.
