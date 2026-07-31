# State-Grouped Basket

Every line stores server-derived product, variant, Market, State, catalog-version, quote-version, currency, and integer minor-unit price snapshots. Client prices are ignored.

`GET /api/v1/cart` returns `stateGroups`. Mutations revalidate publication, availability, variant, quote ownership, quote expiry, product version, and quantity. Compatible duplicate lines merge; variant or quantity changes invalidate an incompatible quote. `DELETE /cart/states/:stateId` removes exactly one State group.

Guest-to-customer conversion transfers the active basket transactionally and preserves a still-valid accepted negotiation outcome. Guest IDs supplied by clients are not trusted.
