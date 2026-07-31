# Outbox And Notifications

`ORDER_APPROVED_FOR_FULFILMENT` is written as an idempotent, versioned `CommerceOutboxEvent` after verified prepayment or approved POD. Phase 4 creates no fulfilment task.

Customer notifications use unique event keys for Order creation, payment confirmation, POD approval, prepayment requirement, and cancellation. Integration mismatches are retained as `IntegrationException` records for Operations review.
