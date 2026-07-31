# Phase 2 Testing And Validation

## Automated Coverage

- `npm test`: focused unit coverage for response envelopes, public-ID counters, and access-scope policies.
- `npm run test:phase2:integration`: isolated direct-domain verification for concurrent public IDs, invitation activation/single use, session revocation, and append-only audit behavior.
- `npm run test:phase2:http`: real Express HTTP verification in a uniquely named temporary database. It covers request IDs, the success/error envelope, guest create/restore/revoke, refresh rotation and replay-family revocation, State-scoped list/detail denial, and immediate suspension denial.

Both Phase 2 validation scripts refuse unsafe database names and drop their temporary database in success and failure paths.

Run on 2026-07-26:

- Backend `npm test -- --runInBand`: 3 suites, 9 tests passed.
- Backend non-fixing ESLint: zero errors, 261 existing warnings.
- Backend `npm run build`: passed.
- Swagger generation: passed, 138 paths.
- Migration backup, restore verification, analyze, dry-run, execution, idempotent rerun, and post-migration verification: passed.
- Isolated Atlas integration validation: passed and test database dropped. Covered 25 concurrent public IDs, invitation activation/single use, account-session revocation, and append-only audit enforcement.
- Admin full ESLint: passed after correcting existing React hook/purity violations.
- Admin `npx tsc --noEmit`: passed.
- Admin production build after route-group and activation work: passed, 46 routes generated.
- Shopper `npm run lint`: passed.
- Shopper `npx tsc --noEmit`: passed.
- Expo Doctor after patch alignment: 18/18 checks passed.

Coverage includes public-ID formatting/concurrency, permission and scope denial, scoped list filters, Super Admin override, request IDs, success/error envelopes, invitation activation, session revocation, and immutable audit records.

HTTP E2E coverage now includes refresh-token replay-family revocation, immediate suspension, public Product lookup, public platform relationship identifiers, State-filtered Hub queries, Staff scope presentation, invitation cancellation, retained-commerce permission denial, and incompatible City/Zone/Market/Hub create and update mutations.

Platform persistence references remain Mongo identifiers internally. HTTP requests accept Hook public identifiers, platform context middleware resolves public State/Hub headers, and platform responses present public identifiers for relationship fields and arrays.
