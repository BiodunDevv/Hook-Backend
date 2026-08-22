# Phase 3 Data Migration Notes

The idempotent tool is `src/database/migrations/phase-03-catalog.ts`.

Modes: `analyze`, `dry-run`, `execute`, `verify`, and `rollback`.

The configured development/QA dataset was explicitly reset on July 31, 2026 and upgraded through the Phase 2 and Phase 3 migrations. Final verification:

- Database: `hook`
- Products: 21 total, 21 migrated, 0 missing `PRD` IDs
- Categories: 0 missing `CAT` IDs
- Negotiations: 8 migrated, 0 legacy
- Phase 3 submissions/variants/media/quotes: 6 / 255 / 14 / 0
- Published Commercial products: 12
- Markets and active Market Associate assignments: 3 / 3
- Verification: 0 invalid products, 0 products without variants, 0 duplicate product public IDs

Execution converts Naira compatibility values to integer minor units, assigns public IDs, creates variants, tags public image URLs as legacy compatibility media, and evolves negotiations in place. Products become Commercial drafts and are never auto-published. Vendor references remain historical.

Execution requires `PHASE_03_MIGRATION_CONFIRMED=true`. Rollback requires a separate explicit confirmation and only removes Phase 3-derived fields and tagged records.

`npm run seed` now orchestrates the guarded base reset, Phase 2 migration, Phase 3 migration, and idempotent Phase 3 QA fixtures. A non-disposable database still requires `ALLOW_DATABASE_RESET=true`; production weak QA credentials still require their separate explicit override.

The July 31 reset was explicitly requested and reconstructive, so no legacy-data backup was required. Future migrations of non-disposable customer data must still use a timestamped `mongodump` and verified isolated `mongorestore` before execution.
