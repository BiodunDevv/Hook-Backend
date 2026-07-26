# Phase 3 API Changelog

Added:

- Runner dashboard, assigned Markets, submission list/detail/create/update/submit/resubmit.
- Signed catalog media upload intent and finalize.
- Admin Catalog Review dashboard, queue, detail, start, request changes, approve, reject.
- Admin Commercial dashboard, drafts, detail, content, pricing, rules, preview, publish, pause, availability-unconfirmed, unpublish.
- Public home, categories, products, product detail, and search.
- Negotiation create, offer, detail, accept, close, and Admin monitoring.

All routes use the Phase 2 success/error envelope, request IDs, public identifiers, authorization policy, and sanitized presenters. Swagger is generated to `swagger-spec.json`; the latest generation contains 167 paths.

Removed from active customer routing: the old negotiation constructor and action handlers that bypassed the Phase 3 service contract.
