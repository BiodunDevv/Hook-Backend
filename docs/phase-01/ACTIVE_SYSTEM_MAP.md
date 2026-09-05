# Active System Map After Phase 1

```text
Hook Shopper
  auth + guest identity
  home + discover + categories/products
  general cart foundation + checkout foundation
  orders + notifications + profile
          |
          v
Hook Express API
  auth/security/uploads/notifications
  public commercial catalog
  customer cart/order/payment/negotiation
  admin RBAC/audit/reporting
          |
          v
MongoDB
  active customer/catalog/order records
  retained legacy vendor/booth/fulfilment/logistics history

Hook Admin
  dashboard
  customers + staff
  commercial catalog + category review
  orders + market associates
  finance/refunds/support
  negotiation/reports/settings
```

Active terminology:

- Commercial Catalog
- Market Associate
- Hook Partner (future architecture)
- Hook Dispatch Hub (future architecture)
- External Logistics Provider
