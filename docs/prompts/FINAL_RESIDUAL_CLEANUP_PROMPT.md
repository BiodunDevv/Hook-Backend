# Final Residual Cleanup Prompt

Before removing Phase 3 compatibility fields, verify the Phase 3 migration, all Phase 4 consumers, historical Order reads, and rollback evidence. Specifically inspect legacy Product Naira fields, public image arrays, Vendor references, old negotiation transcript fields, deprecated statuses, and legacy routes. Remove only after repository-wide consumer proof and database verification.

After Phase 2 migration and data verification:

1. Re-run cross-repository import, route, navigation, API consumer, job, provider, environment, asset, and dependency inventories.
2. Prove legacy Vendor, Booth, fulfilment, settlement, internal Driver/Fleet, and FieldAgent structures have no active or retention requirement.
3. Execute only approved, backed-up, reversible migrations.
4. Remove compatibility aliases after telemetry confirms no old clients use them.
5. Remove old seed fixtures, model relations, indexes, enums, Swagger schemas, and environment keys.
6. Run the complete quality and security pipeline.

Do not delete historical collections solely because active source references are gone.
