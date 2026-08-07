# Returns And Refunds

Customers can report an issue within 24 hours of delivery or collection. Support
reviews the request and records an approval or rejection. Refund creation is a
separate finance-controlled record, and processing calls the active Paystack
provider through the payment service.

The backend checks captured amount minus already refunded amount, requires a
stable idempotency key, records the provider reference, and marks failures
explicitly. Provider errors are not converted into a successful refund state.
