# Phase 3 Data Migration Notes

The idempotent tool is `src/database/migrations/phase-03-catalog.ts`.

Modes: `analyze`, `dry-run`, `execute`, `verify`, and `rollback`.

Current read-only analysis:

- Database: `hook`
- Products: 21 total, 0 migrated, 21 missing `PRD` IDs
- Categories: 5 missing `CAT` IDs
- Negotiations: 8 legacy, 0 migrated
- Phase 3 submissions/variants/media/quotes: 0

Execution converts Naira compatibility values to integer minor units, assigns public IDs, creates variants, tags public image URLs as legacy compatibility media, and evolves negotiations in place. Products become Commercial drafts and are never auto-published. Vendor references remain historical.

Execution requires `PHASE_03_MIGRATION_CONFIRMED=true`. Rollback requires a separate explicit confirmation and only removes Phase 3-derived fields and tagged records.

Do not execute until `mongodump` and `mongorestore` are installed, a timestamped backup is created, and restore verification succeeds. Those binaries were unavailable during this implementation, so no live migration was run.
