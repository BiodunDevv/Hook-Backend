# Phase 4 Data Migration Runbook

1. Confirm the database identity and environment.
2. Create a timestamped `mongodump` and verify restoration into an isolated database.
3. Run `npm run migrate:phase4:analyze` and `npm run migrate:phase4:dry-run`.
4. Review counts and compatibility warnings.
5. Set `PHASE_04_MIGRATION_CONFIRMED=true` only for the reviewed execution.
6. Run `npm run migrate:phase4`, then `npm run migrate:phase4:verify`.
7. Run `npm run seed:phase4` only in approved QA/development environments.

The migration adds public IDs, canonical minor-unit money, ownership/status foundations, indexes, and version markers. It never deletes historical collections. Rollback only removes the Phase 4 marker and requires `PHASE_04_ROLLBACK_CONFIRMED=true`; restoring data still uses the verified dump.
