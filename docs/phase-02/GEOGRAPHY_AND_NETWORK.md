# Geography And Operational Network

Hierarchy:

`Operation State -> Operation City -> Service Zone -> Market -> preferred Dispatch Hub`

Rules enforced by services/controllers:

- Active Cities belong to one active State.
- Zones retain delivery eligibility foundations but do not implement checkout.
- Markets reference compatible State, City, optional Zone, and optional Hub.
- Hubs and assigned Markets must share a State.
- Hook Partners are self-scoped to one configured location.
- Runner Profiles may span configured States and Hubs.
- Runner Market Assignments retain history and must be geographically compatible.
- Operational records use status transitions instead of destructive deletion.

Public geography endpoints return only active, safe fields. Internal configuration and Mongo identifiers are not intended as customer contracts.
