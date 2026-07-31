# Phase 2 Decision Log

1. Retain User as credential identity to avoid a risky account rewrite.
2. Resolve staff roles live rather than embedding authoritative permissions in JWTs.
3. Store one hashed refresh token per Account Session and rotate on refresh.
4. Preserve legacy MongoDB collections and IDs; migrate with source metadata.
5. Keep Runner and Partner route groups in `hook-admin` to avoid another repository and UI stack.
6. Use Mongo atomic counters partitioned by prefix and UTC year.
7. Make audit records append-only at the model boundary and sanitize recursively.
8. Block production seed reset unless explicitly opted in.
9. Refuse production migration execution without a verified external backup.
