# Legacy Data And Migration Notes

Phase 1 performs no destructive MongoDB migration.

Retained legacy structures include:

- Vendor records and product/order source identifiers.
- Booth, booth inventory, attendant assignment, and booth order snapshots.
- Vendor fulfilments and settlement liabilities.
- Internal driver identifiers and logistics timeline fields.
- Legacy roles: `vendor`, `ev_driver`, and persisted `field_agent`.

Compatibility rules:

- Active product creation is admin-owned and cannot assign a Vendor.
- Active Runner APIs map to the persisted field-agent model and `field_agent` role.
- Historical finance records may still contain vendor settlement metadata but no active payout trigger is exposed.
- Historical order/cart documents may contain booth fields; active customer flows do not create or require them.
- Collections and enum values must not be renamed until a versioned, reversible migration and data-retention policy exist.

The reset seed still contains legacy operational fixtures. It was not executed in Phase 1 because it drops the database. Aligning fixtures to the Phase 2 domain must precede any future seed run against a shared environment.
