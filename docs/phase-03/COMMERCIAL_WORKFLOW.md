# Commercial Workflow

Commercial staff can inspect approved-submission drafts, edit customer content, set pricing, set negotiation rules, preview the customer-safe representation, and publish, pause, mark availability unconfirmed, or unpublish.

The backend derives effective price, markup, margin amount, and margin percentage from integer minor units. The UI cannot submit derived values.

Publication checks:

- approved source submission and Commercial approval
- active State, Market, and Category
- title, slug, description, and customer availability copy
- ready owned media and active variants
- positive base and selling prices
- discount and negotiation floor within approved boundaries

All price, rule, content, and lifecycle changes carry optimistic versions and audited reasons.
