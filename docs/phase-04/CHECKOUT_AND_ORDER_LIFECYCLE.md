# Checkout And Order Lifecycle

Preview tokens are persisted as hashes and bind actor, customer, Partner, State, basket version, lines, quotes, totals, delivery/payment methods, policy versions, and expiry.

Fee precedence is Service Zone, Operation State, then the global `300000` minor-unit fallback. Shopper checkout is home delivery only. Partner checkout is prepaid and allows home delivery or pickup from the authenticated initiating Partner.

Confirmation requires the current Terms, Privacy, and Returns versions and an `Idempotency-Key`. Atlas transactions protect preview consumption, Order and item creation, payment creation, quote use, and State-group removal.
