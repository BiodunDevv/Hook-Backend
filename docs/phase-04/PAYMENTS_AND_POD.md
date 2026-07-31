# Payments And Pay At Handover

`PaymentProvider` isolates provider behavior. Paystack Hosted Checkout is the only active prepayment provider. Initialization accepts an owned Order public ID; amount, currency, customer, reference, and metadata come from the Order.

The raw-body webhook validates `x-paystack-signature`, deduplicates provider events, re-queries Paystack, and checks reference, amount, currency, and success status. Shopper deep links trigger polling only and never confirm payment.

POD uses global, State, Zone, and customer eligibility. Approval requires a recorded confirmed call and, above the configured threshold, a one-time Super Admin override. Decline explicitly requires prepayment or cancels the Order. POD collection itself is a Phase 5 responsibility.
