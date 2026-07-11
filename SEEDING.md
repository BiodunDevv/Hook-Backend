# Hook Backend Seed Data

Use this seed for local and staging QA after the database is reachable.

## Command

```bash
npm run seed
```

For development against the configured MongoDB database:

```bash
npm run seed:dev
```

> The runner **clears the database first**, then re-creates everything below. Re-running it always produces the same fresh state.

## Universal Password

Every seeded account — admin, staff, vendors, customers, drivers — uses the same password:

```
123456
```

## Accounts

### Super Admin

| Email | Role | Permissions |
|---|---|---|
| `admin@gmail.com` | `super_admin` | All (implicit — super admins can never be restricted) |

Email is configurable via `SEED_ADMIN_EMAIL` (name via `SEED_ADMIN_FIRST_NAME` / `SEED_ADMIN_LAST_NAME`).

### Staff (admins + support)

Admins have all permissions. Support staff only have their explicitly assigned permissions — the backend enforces this per-endpoint, the sidebar/search/pages follow it on the frontend. Each staff member is also assigned categories they are **in charge of** (shown on products, the Categories page, and their staff card, with their phone as the contact).

| Email | Name | Phone | Role | Permissions | In charge of |
|---|---|---|---|---|---|
| `admin.one@hook.africa` | Chidi Okeke | +2348040000101 | admin | all | Sneakers |
| `admin.two@hook.africa` | Fatima Yusuf | +2348040000102 | admin | all | Streetwear, Accessories |
| `support.one@hook.africa` | Temi Adeyemi | +2348040000103 | support | orders.view/edit, customers.view/edit, products.view | Sneakers |
| `support.two@hook.africa` | Kola Balogun | +2348040000104 | support | vendors.view/approve, products.view/review, reports.view | Streetwear |
| `support.three@hook.africa` | Amaka Eze | +2348040000105 | support | orders.view, drivers.view, financials.view, reports.view, ai_negotiation.view | Accessories |

### Vendors (approved, with owner accounts)

| Owner email | Business | Tier | Commission |
|---|---|---|---|
| `vendor.one@hook.africa` | Lagos Sneaker Lab | tier_1 | 12% |
| `vendor.two@hook.africa` | Mainland Kicks Depot | tier_2 | 15% |
| `vendor.three@hook.africa` | Balogun Market Select | tier_3 | 18% |

### Customers (shoppers)

`customer.one` → `customer.four` `@hook.africa` — Nora Adebayo, Emeka Nwosu, Zainab Ibrahim, Femi Lawal. All verified, with delivery addresses and preferences.

### EV Drivers

`driver.one@hook.africa` (Ife Akin), `driver.two@hook.africa` (Sola Adeyemi).

### Field Agents (market-assigned uploaders)

Field agents are assigned to individual markets, upload listings from the field, and the admin approves/rejects them from the QA Review Queue on `/dashboard/field-agents`.

| Email | Name | Phone | Market |
|---|---|---|---|
| `agent.one@hook.africa` | Chika Nwosu | +2348050000101 | Balogun Market |
| `agent.two@hook.africa` | Ibrahim Sani | +2348050000102 | Yaba (Tejuosho) |
| `agent.three@hook.africa` | Grace Okafor | +2348050000103 | Mandilas |

## Physical Booths (company-owned)

| Booth | Type | Location | Attendant | Status |
|---|---|---|---|---|
| Balogun Phygital Booth | phygital | Balogun Market, Lagos Island | Chika Nwosu | Live |
| Yaba Micro Hub | micro_hub | Tejuosho Ultra Modern Market | Ibrahim Sani | Live |
| Ikeja City Mall Booth | phygital | Ikeja City Mall, Alausa | Grace Okafor | Live |
| Lekki Experience Booth | micro_hub | Admiralty Way, Lekki Phase 1 | — | Offline |

Each booth has an Unsplash preview image and operating hours.

## Categories

Three active categories, each with a free Unsplash image as its display icon. Categories are managed by super admins at `/dashboard/categories`; staff are assigned to them from the Staff page.

| Category | Slug | Icon |
|---|---|---|
| Sneakers | `sneakers` | Unsplash `photo-1542291026-7eec264c27ff` |
| Streetwear | `streetwear` | Unsplash `photo-1523398002811-999ca8dec234` |
| Accessories | `accessories` | Unsplash `photo-1553062407-98eeb64c6a62` |

## Catalog & Operations Data

- **15 approved products** with realistic prices, stock levels, colors, sizes, Hook IDs, and multiple Unsplash image previews — spread across all three categories (10 sneakers, 2 streetwear, 3 accessories) so category-manager displays have variety.
- **6 pending field uploads** (`pending_approval`, `source: field_agent`) attributed to the seeded agents — these populate the QA Review Queue. One title ("Dior Replica Quilted Tote") intentionally trips the counterfeit auto-flag so the flagged-review flow can be tested.
- **6 orders** with line items, payments (Paystack-stubbed), logistics with tracking paths, and per-vendor settlement records across the full status range (pending → delivered).
- **8 AI negotiations** covering accepted, active, declined, and expired states with message history.

## Environment Defaults

```env
SEED_ADMIN_EMAIL=admin@gmail.com
SEED_ADMIN_FIRST_NAME=Hook
SEED_ADMIN_LAST_NAME=Admin
```

> `SEED_ADMIN_PASSWORD` is no longer read — the seed intentionally hardcodes `123456` for every account so QA logins are predictable. Do not run this seed against production data.
