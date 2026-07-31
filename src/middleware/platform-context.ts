import { NextFunction, Request, Response } from 'express';
import { ScopeType } from '@lib/constants';
import { OperationState } from '@models/platform/geography.model';
import { DispatchHub } from '@models/platform/network.model';
import { HttpError } from '@utils/http';

async function internalId(model: any, identifier?: string) {
  if (!identifier) return undefined;
  const query = identifier.match(/^[a-f\d]{24}$/i)
    ? { $or: [{ _id: identifier }, { publicId: identifier }] }
    : { publicId: identifier };
  const record = await model.findOne(query).select('_id').lean();
  if (!record) throw new HttpError(404, 'Operational context was not found', undefined, 'NOT_FOUND');
  return record._id.toString();
}

export async function platformContext(req: Request, _res: Response, next: NextFunction) {
  try {
    const stateId = await internalId(OperationState, req.header('x-hook-state-id')?.trim());
    const hubId = await internalId(DispatchHub, req.header('x-hook-hub-id')?.trim());
  const scope = req.user?.scopeType;
  if (scope !== ScopeType.GLOBAL) {
    if (stateId && !req.user?.assignedStateIds?.includes(stateId)) {
      return next(new HttpError(403, 'The requested state is outside your assigned scope', undefined, 'SCOPE_DENIED'));
    }
    if (hubId && !req.user?.assignedHubIds?.includes(hubId)) {
      return next(new HttpError(403, 'The requested Hub is outside your assigned scope', undefined, 'SCOPE_DENIED'));
    }
  }
  req.platformContext = { stateId, hubId };
  next();
  } catch (error) {
    next(error);
  }
}
