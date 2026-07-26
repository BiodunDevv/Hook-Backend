import { NextFunction, Request, Response } from 'express';
import { ScopeType } from '@lib/constants';
import { HttpError } from '@utils/http';

export function platformContext(req: Request, _res: Response, next: NextFunction) {
  const stateId = req.header('x-hook-state-id')?.trim();
  const hubId = req.header('x-hook-hub-id')?.trim();
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
}
