import { deliverNegotiationStartNotifications } from '@services/negotiation-notifications.service';
import { expireNegotiationsAndQuotes } from '@services/negotiation.service';
import { escalateOverdueAvailabilityChecks } from '@services/catalog-availability.service';
import { sendDailyAvailabilityDigests } from '@services/availability-digest.service';
import { fulfilmentService } from '@services/fulfilment.service';
import { PaymentService } from '@services/payment.service';
import { AccountErasureService } from '@services/account-erasure.service';
import { processPushReceipts } from '@services/push.service';

/**
 * Every recurring job in one place. The API used to start these itself, so
 * each additional instance ran a duplicate of every schedule. They now run in
 * the worker process: through BullMQ job schedulers when Redis is configured
 * (one run per tick across all workers) or through in-process timers for
 * single-process development.
 *
 * Every job must be safe to run twice: overlapping ticks and a crash mid-run
 * are expected.
 */
export type JobDefinition = {
  name: string;
  /** Interval in ms, or a cron pattern. */
  everyMs?: number;
  cron?: string;
  run: () => Promise<unknown>;
};

export const JOBS: JobDefinition[] = [
  // Drains every outbox event type: fulfilment, payment/order/refund effects.
  { name: 'outbox-drain', everyMs: 3_000, run: () => fulfilmentService.processOutboxBatch(10) },
  { name: 'fulfilment-deadlines', everyMs: 5_000, run: () => fulfilmentService.processOperationalDeadlines() },
  { name: 'negotiation-start-notifications', everyMs: 5_000, run: () => deliverNegotiationStartNotifications() },
  {
    name: 'catalog-deadlines',
    everyMs: 60_000,
    run: () => Promise.all([expireNegotiationsAndQuotes(), escalateOverdueAvailabilityChecks()]),
  },
  { name: 'reconcile-payments', everyMs: 60_000, run: () => new PaymentService().reconcileStalePayments() },
  { name: 'reconcile-refunds', everyMs: 120_000, run: () => fulfilmentService.reconcileUnknownRefunds() },
  // Finds dead push tokens (uninstalled apps) from Expo's delivery receipts and stops sending to them.
  { name: 'push-receipts', everyMs: 15 * 60_000, run: () => processPushReceipts() },
  // Erases accounts whose cooling-off ended, and resumes any run a crash interrupted.
  { name: 'account-deletion-erasure', everyMs: 15 * 60_000, run: () => new AccountErasureService().runDue() },
  { name: 'account-deletion-reminders', everyMs: 60 * 60_000, run: () => new AccountErasureService().sendReminders() },
  { name: 'availability-digest', cron: '0 7 * * *', run: () => sendDailyAvailabilityDigests() },
];
