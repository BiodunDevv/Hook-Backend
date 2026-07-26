# Active Backend Route Map

All API routes are under `/api/v1`.

## Public

- Products list/detail
- Home feed
- Categories list/tree/detail
- Operating states
- Search and suggestions

## Customer

- Auth, staged signup, Google login, refresh/logout, password recovery, profile
- Cart CRUD and checkout
- Orders list/detail/cancel/refund request
- Negotiations list/detail/start/counter/accept
- Payment initialize/status/verify and saved-method capability
- Notifications and account deletion request
- Device registration

## Admin

- Dashboard, analytics, health, search
- Operating states
- Customers/users and staff
- Categories and commercial catalog
- Orders
- Runners (persisted through legacy `field_agent` compatibility)
- Support deletion requests and checkout analytics
- Finance, refunds, escrow ledger, reconciliation, audit
- Negotiations, reports, settings

## Infrastructure

- Upload image(s)
- Payment webhook
- Health and optionally enabled Swagger documents

Removed route families: vendor portal, public vendor discovery, booth resolution/session/inventory, internal driver jobs, dispatch assignment, booth administration, vendor administration, vendor fulfilment decisions, and vendor payout triggers.

