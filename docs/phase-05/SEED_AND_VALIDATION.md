# Seed And Validation Runbook

`npm run seed` performs the existing full database reset chain and now ends with
`npm run seed`. This single command drops the development database and rebuilds
all canonical platform, catalog, commerce, and fulfilment fixtures in order. The
fulfilment stage adds active operational scenarios
after Phase 1-4 foundations and deactivates legacy Vendor, Booth, Driver/Fleet,
settlement, and OPay paths for the QA dataset while retaining their records for
historical references. The Phase 5 seed leaves one complete sealed consolidation
without a shipment so the development-only logistics simulator has a safe,
repeatable parcel to book.

The reset script refuses to drop a database when `NODE_ENV=production` unless
`ALLOW_DESTRUCTIVE_SEED=true` is explicitly supplied. Use `npm run seed:dev` for
the intended development reset path and verify `MONGODB_URI` before running it.

The full reset was rerun successfully on 2026-08-01. It dropped and recreated
the configured `hook` database, then completed all seed stages. The final Phase
5 output confirmed fulfilment tasks, Hub packages, consolidation, shipments,
Partner/return-ready scenarios, and a refund queue. Because the Atlas SRV
resolver intermittently returned `ESERVFAIL`/`ECONNREFUSED`, the successful
final run supplied the already-resolved Atlas replica hosts through the command
environment only; no repository `.env` file was changed.

An earlier attempt did not reach the reset step because the local runtime could
not resolve the Atlas SRV record:

```text
queryTxt ESERVFAIL hook.1ou4my0.mongodb.net
```

Those failures either happened before the reset or after the base stage. The
successful final run supersedes them; verify the seed logs and inspect the
database before using the Phase 5 UI.

## Provider readiness verification

On 2026-08-01 the configured Paystack test key was checked against the official
test API. Transaction listing, a ₦100 test-mode initialization, and status
lookup succeeded; the uncompleted transaction correctly returned `abandoned`.
The deployed callback returned the `hook://payments/return` deep-link bridge.
The deployed webhook rejected an unsigned request with 401 and accepted a
correctly signed synthetic non-payment event with 200 while leaving it ignored.

GIG and Fez were also checked and remain intentionally disabled because no
provider enablement flags, webhook secrets, credentials, or verified contracts
are configured. Manual logistics booking remains the active fallback, with the
explicitly gated simulator available only in non-production development mode.
