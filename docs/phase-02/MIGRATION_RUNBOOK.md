# Phase 2 Migration Runbook

## Commands

```bash
npm run migrate:phase2:analyze
npm run migrate:phase2:dry-run
PHASE_02_MIGRATION_CONFIRMED=true npm run migrate:phase2
```

## Required production sequence

1. Confirm database identity.
2. Create a timestamped `mongodump`.
3. Verify the dump is non-empty and restorable with `mongorestore`.
4. Archive analyze and dry-run output.
5. Execute with the explicit confirmation flag.
6. Verify counts, unique indexes, public IDs, profile references, and disabled legacy accounts.
7. Retain source collections and migration metadata.

## Executed checkpoint, 2026-07-26

- Target detected: Atlas database `hook`, `NODE_ENV=production`.
- Analyze: successful.
- Dry-run: successful.
- Official MongoDB Database Tools 100.17.0 were downloaded for macOS x86_64 and verified as signed by MongoDB, Inc.
- Backup archive: `.backups/phase-02/20260726T211917Z/hook.archive.gz` (local, Git-ignored).
- Backup SHA-256: `3c542f6a44465d3214d495f3c7e6ab87f791ee0e895f8ce15a29d2f1853e02a4`.
- Restore verification: successful in an isolated database; 43 collections and 213 documents matched exactly. The verification database was dropped.
- Source counts: 37 legacy States, 20 Users, 3 Market Associate candidates, and 6 Staff candidates.
- Execution: successful and idempotent.
- Post-migration: 37 Operation States, 3 Market Associate profiles, 6 Staff profiles, 12 Roles, and 45 Permissions.
- Legacy Vendor and internal Driver identities: 9 disabled, retained for history.
- Public-ID duplicate check: zero duplicates in Operation States, Staff profiles, Market Associate profiles, and Users.
- Phase 2 indexes were created explicitly because production disables Mongoose `autoIndex`; session, guest-session, and invitation expiry indexes are TTL indexes.
- Temporary restore/test databases: none remain.

No source collection was deleted. Legacy records and migration-source metadata remain available for rollback analysis.

## Final catalogue synchronization, 2026-07-26

- Analyze and dry-run remained idempotent: no State, Staff, or Market Associate records required recreation.
- The confirmed migration rerun completed and verified successfully.
- The unified Role/Permission catalogue now contains 45 permissions and 12 roles.
- Retained commerce permissions are assigned through live Role records; legacy user role enums no longer bypass authorization.
- The previously verified archive remains the rollback baseline. This synchronization changed only idempotent Phase 2 foundation/catalogue records and did not delete source data.
