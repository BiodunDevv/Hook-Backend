import { fulfilmentService } from '@services/fulfilment.service';

let workerTimer: NodeJS.Timeout | undefined;

export function startFulfilmentWorker() {
  if (workerTimer) return;
  const tick = () => {
    void Promise.all([
      fulfilmentService.processOutboxBatch(5),
      fulfilmentService.processOperationalDeadlines(),
    ]).catch((error) => {
      console.error('[fulfilment-worker] tick failed', error);
    });
  };
  tick();
  workerTimer = setInterval(tick, 5000);
  workerTimer.unref();
}

export function stopFulfilmentWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = undefined;
}
