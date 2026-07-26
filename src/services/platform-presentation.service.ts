import { OperationCity, OperationState, ServiceZone } from '@models/platform/geography.model';
import { DispatchHub, Market } from '@models/platform/network.model';
import {
  RunnerProfile,
  StaffProfile,
} from '@models/platform/operations-accounts.model';
import { User } from '@models/users/user.model';

type PlatformRecord = Record<string, any>;

const referenceModels = {
  accountId: User,
  createdBy: User,
  updatedBy: User,
  stateId: OperationState,
  cityId: OperationCity,
  zoneId: ServiceZone,
  hubId: DispatchHub,
  preferredHubId: DispatchHub,
  runnerId: RunnerProfile,
  marketId: Market,
} as const;

const referenceArrayModels = {
  stateIds: OperationState,
  assignedStateIds: OperationState,
  cityIds: OperationCity,
  zoneIds: ServiceZone,
  hubIds: DispatchHub,
  assignedHubIds: DispatchHub,
  marketIds: Market,
  staffIds: StaffProfile,
} as const;

function stringId(value: unknown) {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value && 'toString' in value) return value.toString();
  return String(value);
}

async function publicIdMap(model: any, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map<string, string>();
  const records = await model.find({ _id: { $in: ids } }).select('_id publicId').lean();
  return new Map<string, string>(
    records.map((record: any) => [record._id.toString(), record.publicId]),
  );
}

/**
 * Converts persistence references to stable public identifiers at the HTTP boundary.
 * Role IDs remain internal because roles intentionally do not have a Hook public ID.
 */
export async function presentPlatformRecords(input: PlatformRecord | PlatformRecord[]): Promise<any> {
  const records = (Array.isArray(input) ? input : [input]).map((record) => ({ ...record }));
  const maps: Record<string, Map<string, string>> = {};

  await Promise.all([
    ...Object.entries(referenceModels).map(async ([field, model]) => {
      const ids = records.map((record) => stringId(record[field])).filter(Boolean) as string[];
      maps[field] = await publicIdMap(model, [...new Set(ids)]);
    }),
    ...Object.entries(referenceArrayModels).map(async ([field, model]) => {
      const ids = records.flatMap((record) =>
        Array.isArray(record[field]) ? record[field].map(stringId).filter(Boolean) : [],
      ) as string[];
      maps[field] = await publicIdMap(model, [...new Set(ids)]);
    }),
  ]);

  const presented = records.map((record) => {
    const output = { ...record };
    for (const field of Object.keys(referenceModels)) {
      const id = stringId(output[field]);
      if (id) output[field] = maps[field].get(id) || id;
    }
    for (const field of Object.keys(referenceArrayModels)) {
      if (Array.isArray(output[field])) {
        output[field] = output[field].map((value: unknown) => {
          const id = stringId(value)!;
          return maps[field].get(id) || id;
        });
      }
    }
    if (output.publicId) output.id = output.publicId;
    delete output._id;
    return output;
  });

  return Array.isArray(input) ? presented : presented[0];
}
