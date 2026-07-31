# Phase 1 Removal Ledger

## Phase 4 continuation

- Active Booth, Vendor, gift, and OPay checkout ownership was replaced by customer, guest-session, and Partner-assisted State commerce.
- Client payment verification and generic Admin Order creation/status mutation are no longer active registered routes.
- Historical Booth, Vendor, gift, OPay, fulfilment, and major-unit records remain compatibility data pending retention approval.
- Physical sourcing, fulfilment, handover collection, returns, and refunds remain deferred to Phase 5.

## Phase 3 continuation

- Legacy customer negotiation handlers were removed after the Phase 3 negotiation service and routes became the only active consumer path.
- Active Admin negotiation monitoring was replaced with a public-ID and permission-aware presenter that does not disclose pricing floors.
- Vendor collections and historical references remain preserved; they were not renamed or deleted.
- Product compatibility price/media fields remain pending verified Phase 3 migration and Phase 4 consumer proof.

| Surface                            | Evidence                                                                                                                                                                     | Data impact                                                       | Replacement / disposition                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| Admin Vendors                      | Pages, nav, permissions, filters, API consumers and backend admin routes formed a self-contained obsolete workflow. Shopper vendor page was its remaining customer consumer. | Vendor collections and foreign keys preserved.                    | Future Hook Partner model, not a mechanical rename.       |
| Vendor portal                      | `/vendors/me`, registration, products, orders, settlements and bank workflows had no retained client after app/admin cleanup.                                                | Vendor and settlement history preserved.                          | Phase 2 partner architecture.                             |
| Booth commerce                     | Admin Booth pages, shopper scanner/session/catalog routes, public booth routes and cart session enforcement were cross-repository consumers. All were removed together.      | Booth, inventory, assignment and order snapshot fields preserved. | Future Hook Partner / Dispatch Hub design.                |
| Internal Drivers/Fleet             | Admin Driver pages, dispatch map, assignment endpoints, vendor pickup and driver job APIs were coupled internal-fleet operations.                                            | Logistics and driver-role records preserved for history.          | External Logistics Provider integration in a later phase. |
| Field Agent naming                 | Active UI/API/permissions used inconsistent Field Agent wording.                                                                                                             | Persisted `field_agent` role and model retained.                  | Active term is Runner through compatibility mapping.      |
| Source-specific product assignment | Admin create/edit/search still accepted and displayed active Vendor assignment.                                                                                              | Existing `vendorId` and source values preserved read-only.        | Commercial Catalog owns new admin products.               |
| Obsolete loaders/assets            | Mobile Lottie loader had one replaceable consumer; scanner dependencies became unreferenced after route removal.                                                             | None.                                                             | Shared HookLoader.                                        |
| Dead web dependencies              | Mapbox and QR packages had no imports after operations pages were removed.                                                                                                   | None.                                                             | Removed from admin dependencies.                          |

For each removal, searches covered imports, route registration, navigation, API consumers, model references, seed/jobs, provider/env references, and cross-repository routes. Historical model references were intentionally retained where deletion would affect persisted records.
