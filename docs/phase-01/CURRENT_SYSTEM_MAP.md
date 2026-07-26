# Current System Map At Baseline

```text
Hook Admin
  -> admin auth/RBAC
  -> customers, staff, products, categories, orders
  -> vendors, booths, drivers, field agents
  -> finance, refunds, negotiation, reports, settings

Hook Shopper
  -> auth/guest identity
  -> home/discover
  -> booth scan/code -> booth session -> booth catalog
  -> vendor/product views
  -> booth-aware cart -> checkout -> payment
  -> orders, notifications, profile

Hook Backend
  -> MongoDB/Mongoose
  -> public catalog + booth/vendor discovery
  -> customer cart/order/payment/negotiation
  -> vendor portal
  -> booth access/inventory
  -> internal driver/logistics execution
  -> admin operations
  -> Brevo, Cloudinary, Expo Push, Google, payment adapters
```

The baseline mixed future Hook concepts with obsolete Booth, Vendor portal, and internal Fleet ownership. Persisted legacy identifiers crossed products, orders, payments, settlements, fulfilments, and logistics.

