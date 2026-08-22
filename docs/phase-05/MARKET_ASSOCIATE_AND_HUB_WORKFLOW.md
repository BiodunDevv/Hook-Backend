# Market Associate And Hub Workflow

## Market Associate states

`ALERTED -> ACCEPTED -> SOURCING -> PRODUCT_SECURED -> PACKING -> READY_FOR_HUB`

The Market Associate account, active Market assignment, State, task version, and evidence
are checked by the service. Actual sourcing cost is internal and never changes a
customer price. Issue reports block the task and create an auditable exception.

## Hub states

`QC_PENDING -> QC_PASSED | QC_FAILED -> CONSOLIDATED`

Hub staff must receive with the Market Associate credential and then record visible QC.
Failed QC leaves the item incomplete and opens an exception. Consolidation and
sealing are rejected if any active item is missing a QC-passed package.
