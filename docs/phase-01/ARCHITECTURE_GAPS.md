# Architecture Gaps

## Critical

- Negotiation round-four acceptance can bypass the minimum floor.
- Negotiated prices are not bound to cart or checkout.
- Active checkout is coupled to OPay while the guide identifies Paystack as MVP. Provider selection and webhook trust need a deliberate Phase 2 decision.
- The public payment `verify` contract must be reviewed to ensure no client-controlled success path remains.

## Domain

- Market, Hook Partner, Hook Dispatch Hub, and external logistics provider models do not yet exist.
- Runner remains backed by legacy FieldAgent persistence.
- General product details, state-grouped basket, fulfillment tracking, and returns are incomplete in the shopper app.
- Admin commercial catalog has legacy source fields in historical records but no explicit partner-supply contract.

## Data And Operations

- Seed fixtures still create legacy vendors, booths, drivers, fulfilments, and OPay scenarios.
- There is no migration registry for legacy collection retirement.
- Existing automated tests were not assessed or run by Phase 1 instruction.
- Mobile dependency audit reports known vulnerabilities that require a separate controlled upgrade effort.

## Quality

- Several controllers perform in-memory filtering and aggregation.
- API contracts are not generated from shared schemas.
- Audit coverage is incomplete for negotiation and some status transitions.
