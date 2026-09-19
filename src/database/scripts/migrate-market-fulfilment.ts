import { connectDatabase, disconnectDatabase } from '@config/data-source';
import { RunnerPackage } from '@models/fulfilment/fulfilment.model';
import { ItemResolution } from '@models/fulfilment/item-resolution.model';

async function main() {
  await connectDatabase();
  const duplicateActiveCodes = await RunnerPackage.aggregate([
    { $match: { status: 'READY_FOR_HUB' } },
    { $group: { _id: { hubId: '$hubId', scanCredentialHash: '$scanCredentialHash' }, count: { $sum: 1 }, packageIds: { $push: '$publicId' } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  if (duplicateActiveCodes.length) {
    throw new Error(`Cannot create the active handover-code index: ${duplicateActiveCodes.length} duplicate Hub/code pair(s) require review`);
  }
  await Promise.all([RunnerPackage.createIndexes(), ItemResolution.createIndexes()]);
  console.log('Market fulfilment indexes are ready');
}

void main().finally(() => disconnectDatabase());
