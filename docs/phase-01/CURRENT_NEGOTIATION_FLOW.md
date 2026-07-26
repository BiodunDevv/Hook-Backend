# Current Negotiation Flow

## Implemented Flow

1. An authenticated shopper or guest owner starts a negotiation for a product.
2. The service snapshots product title, list price, and minimum acceptable price.
3. An offer at or above the floor is accepted immediately.
4. Otherwise the service calculates deterministic midpoint counters.
5. Customer counter and accept commands update the negotiation and message history.

No OpenAI or Azure model is called by the active service.

## Findings

- Guest ownership is written into the `userId` field even though a separate guest field exists. This conflates identity domains.
- On round four, `counter()` may accept an offer below the configured floor. This is a pricing-control defect.
- `accept()` does not revalidate quote age, stock, current price, or floor.
- Negotiated prices do not propagate into cart or checkout pricing.
- There is no quote expiration, command idempotency, replay protection, or signed quote.
- Product values are snapshotted, but negotiation state changes lack a dedicated immutable audit trail.
- Text-only validation exists; attachment/media handling is not an active path.

These findings require a Phase 2 negotiation contract and security design. They were documented rather than rebuilt in Phase 1.
