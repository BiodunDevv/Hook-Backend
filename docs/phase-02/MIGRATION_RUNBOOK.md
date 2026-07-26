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

## Current checkpoint, 2026-07-26

- Target detected: Atlas database `hook`, `NODE_ENV=production`.
- Analyze: successful.
- Dry-run: successful.
- Source counts: 37 legacy States, 18 typed-account candidates, 3 Runner candidates, 6 Staff candidates.
- Execution: not performed.
- Reason: `mongodump` and `mongorestore` are unavailable, so backup and restore verification cannot satisfy the mandatory safety gate.

No source record was deleted or mutated by analyze/dry-run.
