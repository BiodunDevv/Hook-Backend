# Product Submission Workflow

Valid transitions:

1. `DRAFT -> SUBMITTED`
2. `SUBMITTED -> IN_REVIEW`
3. `IN_REVIEW -> CHANGES_REQUESTED | APPROVED | REJECTED`
4. `CHANGES_REQUESTED -> SUBMITTED`

Runner creation derives State from the assigned Market. Submission requires an active Runner, active Market assignment, title, category suggestion, base price in minor units, availability, at least one owned ready media asset, and variants.

Every mutation uses an optimistic `version`. Ownership and State scope are enforced in services. Review decisions require a reason and are audited. Approval preserves the submitted snapshot and creates one Commercial draft; it never publishes automatically.
