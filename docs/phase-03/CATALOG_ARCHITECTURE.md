# Catalog Architecture

## Ownership

- Runner owns mutable submission drafts for actively assigned Markets.
- Catalog Review owns workflow decisions and immutable approval snapshots.
- Commercial owns customer content, integer minor-unit pricing, negotiation limits, approval, publication, and availability.
- Backend services own transitions and geography/scope enforcement.
- `Product` remains the existing collection so historical Order references stay valid.

## Core Records

- `ProductSubmission` (`SUB`): Runner evidence, Market/State provenance, variants, media, review feedback, optimistic version.
- `CatalogMediaAsset`: signed Cloudinary metadata and ownership; legacy external URLs are tagged compatibility media.
- `Product` (`PRD`): Commercial product evolved in place.
- `ProductVariant` (`VAR`): sellable attributes and SKU.
- `Category` (`CAT`): public category identity.

Approval creates exactly one Commercial draft from a submission. Publication requires complete content, active geography/category, ready media, active variants, valid pricing and rules, and Commercial approval.

Public presenters expose public IDs, customer content, effective prices, media, variants, category, Market, and State only. Base price, margin, floors, Runner identity, source Vendor references, review notes, Mongo IDs, and audit data are excluded.

Availability can be marked unconfirmed, paused, or unpublished through explicit audited actions. Phase 4 must consume this contract without recreating availability or price rules in clients.
