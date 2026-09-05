# Fulfilment Architecture

`ORDER_APPROVED_FOR_FULFILMENT` is the only entry point for active fulfilment
work. The outbox worker claims that event with a lease and creates one task per
active Market represented in the State Order. A missing primary Market Associate
assignment or compatible Hub creates an exception rather than an unowned task.

Market Associate actions advance a versioned task through acceptance, sourcing, securing,
packing, and Hub handover. A package credential is stored only as a digest and
is returned once when the Market Associate creates the package. Hub receiving verifies the
credential, destination Hub, and idempotency key before creating the Hub package.

Consolidation requires a QC-passed Hub package for every unresolved Order Item.
Only then can Operations seal one State Order parcel. Customer Order status and
shipment/package statuses remain separate.
