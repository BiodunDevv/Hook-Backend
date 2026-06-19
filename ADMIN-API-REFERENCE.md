# Hook Backend — Admin API Reference

**Base URL:** `http://localhost:3000/api/v1`

**Auth:** All admin endpoints require a **Bearer JWT token** in the `Authorization` header.
```
Authorization: Bearer <token>
```

**Admin Login:** Use `POST /api/v1/auth/login` with:
```json
{
  "email": "admin@hook.ng",
  "password": "admin123"
}
```

---

## 🏠 Dashboard

### `GET /admin/dashboard`
All key metrics — users, vendors, products, orders, revenue, logistics, negotiations, settlements.

### `GET /admin/analytics`
Granular analytics with trend data.
| Param | Type | Description |
|-------|------|-------------|
| `from` | string | Start date |
| `to` | string | End date |
| `period` | string | `daily`, `weekly`, or `monthly` |

### `GET /admin/health`
System health check (uptime, memory, DB status).

---

## 👥 Customers (Users)

### `GET /admin/users`
List users with pagination & filters.
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Default: 1 |
| `limit` | number | Default: 20 |
| `role` | string | Filter by role |
| `search` | string | Search by name/email |

### `GET /admin/users/:id`
User details with relationships (vendors, orders).

### `POST /admin/users`
Create a user. *(super_admin only)*
```json
{
  "email": "user@example.com",
  "password": "securepass",
  "firstName": "John",
  "lastName": "Doe",
  "role": "shopper"
}
```

### `PATCH /admin/users/:id/toggle`
Activate / deactivate a user.

### `PATCH /admin/users/:id/role`
Change user role. *(super_admin only)*
```json
{ "role": "admin" }
```

---

## 🏪 Vendors

### `GET /admin/vendors`
List vendors (filter by `?approved=true/false`).

### `PATCH /admin/vendors/:id/approve`
Approve a vendor application.

### `PATCH /admin/vendors/:id/reject`
Reject a vendor.
```json
{ "reason": "Incomplete documentation" }
```

### `PATCH /admin/vendors/:id/tier`
Update vendor tier & commission.
```json
{
  "tier": "tier_1",
  "commissionPercentage": 10
}
```

---

## 📦 Orders

### `GET /admin/orders`
List orders (filter by `?status=pending`).

### `GET /admin/orders/:id`
Full order detail with user, items, products, payment, logistics.

### `PATCH /admin/orders/:id/status`
Update order status (admin override).
```json
{
  "status": "delivered",
  "reason": "Customer confirmed receipt"
}
```

---

## 🛍️ Products

### `GET /admin/products`
Full product catalog with filters (`?status=`, `?vendorId=`).

### `GET /admin/products/review`
QA review queue — products pending approval.

### `PATCH /admin/products/:id/review`
Approve or reject a product listing.
```json
{
  "status": "approved",
  "reviewNote": "Looks good",
  "adjustedSellingPrice": 15000
}
```

---

## 🚚 Dispatch / Drivers

### `GET /admin/dispatch`
All delivery records.

### `GET /admin/dispatch/active`
Active deliveries currently in transit.

### `GET /admin/dispatch/drivers`
List available EV drivers with availability status.

---

## 🕵️ Field Agents

### `GET /admin/field-agents`
List all field agents.

### `GET /admin/field-agents/:id`
Get field agent details.

### `PATCH /admin/field-agents/:id/toggle`
Activate / deactivate a field agent.

---

## 📍 Booths

### `GET /admin/booths`
List all booths.

### `GET /admin/booths/analytics`
Booth analytics summary (total, active, inactive).

### `GET /admin/booths/:id`
Get booth details.

### `PATCH /admin/booths/:id/status`
Toggle booth active status.

### `POST /admin/booths`
Provision a new booth. *(super_admin only)*
```json
{
  "name": "Balogun Main Gate",
  "location": { "address": "Lagos", "lat": 6.5, "lng": 3.3 }
}
```

---

## 💰 Financials 🔒 *(super_admin only)*

### `GET /admin/financials`
Financial dashboard — GMV, commissions, revenue, pending payouts.
| Param | Type | Description |
|-------|------|-------------|
| `from` | string | Start date (ISO) |
| `to` | string | End date (ISO) |
| `maxDays` | number | Max date range (default: 365) |

### `GET /admin/financials/settlements`
Vendor settlement records with pagination.

### `POST /admin/financials/settlements/trigger/:vendorId`
Trigger vendor payout. *(Idempotent — send `X-Idempotency-Key` header)*
```json
{
  "vendorId": "uuid-here",
  "idempotencyKey": "payout-oct-2026-001",
  "reason": "Monthly settlement"
}
```

---

## 🤖 AI Negotiation

### `GET /admin/negotiations`
Negotiation activity with conversion stats.

---

## 📊 Reports

### `GET /admin/reports`
List generated reports.

### `POST /admin/reports/generate`
Generate a new analytics report.
```json
{
  "type": "sales",
  "period": { "from": "2026-01-01", "to": "2026-06-19" }
}
```
Types: `sales`, `vendor_performance`, `customer_analytics`, `logistics`, `custom`

---

## ⚙️ Settings

### `GET /admin/settings`
Get current platform settings.

### `PATCH /admin/settings`
Update platform settings. *(super_admin only)*
```json
{
  "defaultCommissionPercentage": 15,
  "deliveryFeePerKm": 200,
  "maintenanceMode": false
}
```

---

## 📎 How to Access Swagger UI

The full interactive Swagger documentation is available at:

```
http://localhost:3000/docs
```

1. Open the URL in a browser
2. Click **"Authorize"** (top-right)
3. Paste your JWT token: `eyJhbGciOiJIUzI1NiIs...`
4. Now you can test any endpoint directly from the browser
