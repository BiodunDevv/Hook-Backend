# Catalog Permission Matrix

| Capability | Market Associate | Catalog Reviewer | Commercial | Super Admin |
|---|---:|---:|---:|---:|
| Own draft/submission | Self | No | No | Oversight |
| Review queue/detail | No | Scoped | Read | Yes |
| Start/decide review | No | Scoped | No | Yes |
| Commercial drafts | No | Read | Scoped | Yes |
| Customer content/pricing/rules | No | No | Scoped | Yes |
| Publish/pause/unpublish | No | No | Scoped | Yes |
| Negotiation monitor | No | Authorized read | Authorized read | Yes |
| Signed media intent/finalize | Own assets | Review delivery | Commercial assets | Yes |

Middleware checks the coarse permission. Services enforce ownership, workflow, optimistic version, State scope, and entity relationships. Role changes remain immediate through Phase 2 database-backed permission evaluation.
