# Phase 4 Security Review

- Clients cannot supply prices, totals, payment confirmation, Partner identity, pickup location, or operational status.
- Guest ownership uses hashed backend-issued session tokens.
- Checkout previews and refreshable identities are hashed at rest.
- Idempotency protects checkout confirmation, webhook events, notifications, and fulfilment outbox events.
- Paystack secrets remain backend-only and are redacted from logs and API output.
- Payment mismatches are recorded without exposing provider internals to customers.
- State, Partner, customer, and Super Admin boundaries are enforced in backend queries and services.
- Historical OPay fields remain data compatibility only; OPay is not an active checkout path.
