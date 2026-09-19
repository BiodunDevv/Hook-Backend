import cron, { type ScheduledTask } from 'node-cron';
import { JOBS, type JobDefinition } from './definitions';
import { claimRun } from './claim';

const timers: NodeJS.Timeout[] = [];
const tasks: ScheduledTask[] = [];
const running = new Set<string>();

async function runOnce(job: JobDefinition) {
  const { name, run } = job;
  // Never overlap a job with itself inside one process.
  if (running.has(name)) return;
  running.add(name);
  try {
    // ...or with the same tick in another process (a separate worker, or another API).
    if (!(await claimRun(job))) return;
    await run();
  } catch (error) {
    console.error(`[jobs] ${name} failed`, error instanceof Error ? error.message : error);
  } finally {
    running.delete(name);
  }
}

/**
 * Development / single-process fallback. With Redis configured each tick is
 * claimed with a lock shared with the BullMQ worker, so running both is safe:
 * whichever fires first runs it. Without Redis nothing can stop two API
 * instances both running each job, so production runs `npm run worker`
 * instead and leaves this off.
 */
export function startInProcessJobs() {
  for (const job of JOBS) {
    if (job.everyMs) {
      const timer = setInterval(() => void runOnce(job), job.everyMs);
      timer.unref();
      timers.push(timer);
      void runOnce(job);
    } else if (job.cron) {
      tasks.push(cron.schedule(job.cron, () => void runOnce(job)));
    }
  }
}

export function stopInProcessJobs() {
  for (const timer of timers.splice(0)) clearInterval(timer);
  for (const task of tasks.splice(0)) task.stop();
}
