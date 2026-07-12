import { Request, Response } from 'express';
import { auditAdminAction } from '@lib/audit';
import { DEFAULT_OPERATIONAL_STATE_CODE, NIGERIAN_STATES } from '@lib/nigeria-states';
import { OperationalState } from '@models/operations/operational-state.model';
import { ensureOperationalStatesCatalog, normalizeStateCode } from '@services/operational-state.service';
import { HttpError, sendSuccess } from '@utils/http';

export class AdminOperationsController {
  listStates = async (req: Request, res: Response) => {
    await ensureOperationalStatesCatalog();
    const activeOnly = req.query.active === 'true';
    const rows = await OperationalState.find(activeOnly ? { isEnabled: true } : {})
      .sort({ sortOrder: 1, name: 1 })
      .lean({ virtuals: true });
    sendSuccess(res, rows);
  };

  setStateStatus = async (req: Request, res: Response) => {
    await ensureOperationalStatesCatalog();
    const code = normalizeStateCode(req.params.code);
    if (!code) throw new HttpError(400, 'State code is required');

    const state = await OperationalState.findOne({ code });
    if (!state) throw new HttpError(404, 'Operating state not found');

    const isEnabled = Boolean(req.body.isEnabled);
    if (code === DEFAULT_OPERATIONAL_STATE_CODE && !isEnabled) {
      throw new HttpError(400, 'Lagos must remain enabled as the default operating state');
    }

    state.isEnabled = isEnabled;
    state.enabledAt = isEnabled ? state.enabledAt || new Date() : undefined;
    await state.save();

    await auditAdminAction(req, 'operations.state.update', 'operational_state', state.id, {
      code,
      isEnabled,
    });

    sendSuccess(res, state.toJSON());
  };

  resetCatalog = async (_req: Request, res: Response) => {
    await OperationalState.deleteMany({});
    await OperationalState.insertMany(NIGERIAN_STATES.map((state) => ({
      ...state,
      countryCode: 'NG',
      countryName: 'Nigeria',
      isEnabled: state.code === DEFAULT_OPERATIONAL_STATE_CODE,
      enabledAt: state.code === DEFAULT_OPERATIONAL_STATE_CODE ? new Date() : undefined,
    })));
    const rows = await OperationalState.find({}).sort({ sortOrder: 1 }).lean({ virtuals: true });
    sendSuccess(res, rows);
  };
}
