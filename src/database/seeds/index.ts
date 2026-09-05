import { runSimpleSeed } from './simple';

runSimpleSeed()
  .catch((error) => {
    console.error('Hook seed failed');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { disconnectDatabase } = await import('@config/data-source');
    await disconnectDatabase().catch(() => undefined);
  });
