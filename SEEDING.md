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

## Admin Login

- Email: `admin@gmail.com`
- Password: `123456`
- Role: `super_admin`

The default weak admin password is blocked in production unless `ALLOW_WEAK_PRODUCTION_SEED=true` is set or `SEED_ADMIN_PASSWORD` is changed.

## Seeded Test Data

The runner is idempotent. Re-running it updates matching records instead of intentionally duplicating test data.

- 1 super admin user.
- 3 active product categories: Sneakers, Streetwear, Accessories.
- 3 approved vendors with owner accounts:
  - `vendor.one@hook.africa`
  - `vendor.two@hook.africa`
  - `vendor.three@hook.africa`
- 15 approved products with realistic prices, stock levels, colors, sizes, Hook IDs, and multiple image previews.
- 4 shopper/customer accounts.
- 2 EV driver accounts.
- 6 orders with line items, payments, logistics, tracking metadata, and settlement records.

Seeded products use multiple QA images, including:

```text
https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTF8fHNuZWFrZXJzfGVufDB8fDB8fHww
```

## Environment Defaults

```env
SEED_ADMIN_EMAIL=admin@gmail.com
SEED_ADMIN_PASSWORD=123456
SEED_ADMIN_FIRST_NAME=Hook
SEED_ADMIN_LAST_NAME=Admin
```
