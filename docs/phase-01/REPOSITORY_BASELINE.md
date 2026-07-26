# Repository Baseline

## Admin

Next.js 16, React 19, TypeScript, Tailwind, shadcn wrappers, React Query, JWT session handling, and Sonner. Before cleanup it exposed Vendor approval, Booth operations, internal Drivers/Fleet, and Field Agent surfaces alongside retained admin capabilities.

## Backend

Express, TypeScript, Mongoose/MongoDB, Zod, JWT, Brevo, Cloudinary, Expo notifications, Swagger, and payment adapters. The API contained active shopper, vendor, booth, internal logistics, admin, and webhook route families. Legacy commerce models are interrelated and cannot be deleted without a designed migration.

## Shopper

Expo Router, React Native, TypeScript, React Query, NativeWind, Secure Store, notifications, and Google AuthSession. Before cleanup the application exposed booth scanning, booth sessions, booth-only catalogs, vendor detail, and booth-aware cart behavior.

## Runtime Assumptions

- Backend requires MongoDB and validated auth/CORS configuration.
- Admin expects the backend API under its configured public API URL.
- Shopper expects `EXPO_PUBLIC_API_URL`; Google platform client IDs are public OAuth identifiers and remain mobile build configuration.
- MongoDB collections may contain legacy Vendor, Booth, fulfilment, settlement, and internal logistics records.

