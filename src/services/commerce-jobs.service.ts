import { FulfilmentService } from './fulfilment.service';

export function startCommerceJobs() {
  if (process.env.COMMERCE_JOBS_ENABLED === 'false') return () => undefined;
  const fulfilments = new FulfilmentService();
  const run = async () => {
    try {
      await fulfilments.expireOverdue();
    } catch (error) {
      console.error('[commerce-jobs] cycle failed:', error instanceof Error ? error.message : error);
    }
  };

  const interval = setInterval(run, Number(process.env.COMMERCE_JOBS_INTERVAL_MS || 60_000));
  interval.unref();
  void run();
  return () => clearInterval(interval);
}
