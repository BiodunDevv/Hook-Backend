# RBAC And Scope

Roles are data, not token claims. The authorization middleware resolves active Staff Profile roles for every protected request so permission changes take effect immediately.

Initial roles:

`SUPER_ADMIN`, `OPERATIONS_LEAD`, `STATE_OPERATIONS_MANAGER`, `COMMERCIAL_MANAGER`, `COMMERCIAL_OFFICER`, `CATALOG_REVIEWER`, `DISPATCH_HUB_MANAGER`, `DISPATCH_HUB_OFFICER`, `LOGISTICS_OFFICER`, `CUSTOMER_SUPPORT_OFFICER`, `FINANCE_OFFICER`, and `MANAGEMENT_VIEWER`.

Scopes:

- Global: unrestricted records allowed by permission.
- Multi-state / single-state: record and list filters constrained to assigned states.
- Hub: state and Hub constraints are both applied.
- Self: Market Associate and Partner APIs resolve records from the authenticated account, never a client ID.

Changing a selected state removes the client Hub context. The backend independently rejects a state or Hub not assigned to the staff account. Suspension revokes all active sessions.
