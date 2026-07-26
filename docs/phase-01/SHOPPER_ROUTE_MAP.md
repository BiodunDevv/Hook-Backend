# Active Shopper Route Map

## Entry And Authentication

- `/splash`
- `/onboarding`
- `/auth`
- `/auth/password`
- `/auth/create-password`
- `/auth/verify-email`
- `/auth/enter-name`
- `/auth/forgot-password`
- `/auth/reset-code`
- `/auth/create-new-password`
- `/auth/guest-mode`
- `/auth/congratulations`

## Main Application

- `/(tabs)` Home
- `/(tabs)/location` Discover
- `/(tabs)/orders`
- `/(tabs)/profile`
- `/cart`
- `/checkout`
- `/notifications`
- `/notifications/[id]`

Removed active routes: Scan, booth catalog, booth product detail, and vendor detail. The cart now represents a general customer basket rather than a booth session.

Known Phase 2 gap: there is not yet a general product-detail route after obsolete source-specific detail routes were removed.

