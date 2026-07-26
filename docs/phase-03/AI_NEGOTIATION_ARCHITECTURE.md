# AI Negotiation Architecture

`NegotiationService` owns identity, public product/variant resolution, idempotency, offer limits, pricing snapshots, transitions, transcript retention, quote creation, and expiry. `PricingEngineService` returns the deterministic decision.

`AzureNegotiationService` uses the official Azure OpenAI client only to rewrite approved Hook wording. Its response is schema-limited and validated against the deterministic decision. Unexpected fields, changed prices, floor disclosure, oversized output, provider errors, or missing configuration activate audited deterministic fallback wording.

Sessions use `NEG` IDs. Accepted verified-customer sessions create one immutable `QTE` quote, valid for 30 minutes and bound to customer, product, variant, quantity, currency, and rule snapshot. Guests may negotiate but do not receive a persistent accepted quote. Request-time checks and the background expiry job close stale sessions and quotes.

Provider keys remain backend-only. Transcripts exclude secrets and internal floors. Admin monitoring returns operational outcomes without unauthorized floor data.

Phase 4 must validate quote ownership, expiry, product/variant availability, quantity, and immutable amount again when attaching a quote to a basket or order.
