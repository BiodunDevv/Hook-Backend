import { Router } from 'express';
import { AccountType } from '@lib/constants';
import { AuthController } from '@controllers/auth.controller';
import { requireAccountType, requireAuth } from '@middleware/auth';
import { validateBody } from '@middleware/validate';
import { HookPartner, RunnerMarketAssignment, RunnerProfile } from '@models/platform/operations-accounts.model';
import { Market } from '@models/platform/network.model';
import { User } from '@models/users/user.model';
import { asyncHandler, HttpError, sendSuccess } from '@utils/http';
import { loginSchema } from '@validations/common.schemas';

export function createRunnerRouter() {
  const router = Router();
  const auth = new AuthController();
  router.post('/auth/login', validateBody(loginSchema), asyncHandler(auth.runnerLogin));
  router.use(requireAuth, requireAccountType(AccountType.RUNNER));
  router.get('/profile', asyncHandler(async (req, res) => {
    const [account, profile] = await Promise.all([
      User.findById(req.user!.sub).select('-password -refreshToken').lean({ virtuals: true }),
      RunnerProfile.findOne({ accountId: req.user!.sub }).lean({ virtuals: true }),
    ]);
    if (!profile) throw new HttpError(404, 'Runner profile not found', undefined, 'NOT_FOUND');
    sendSuccess(res, { account, profile });
  }));
  router.patch('/profile', asyncHandler(async (req, res) => {
    const allowed = (({ phone, avatarUrl, preferences }) => ({ phone, avatarUrl, preferences }))(req.body);
    const account = await User.findByIdAndUpdate(req.user!.sub, { $set: allowed }, { returnDocument: 'after' }).select('-password -refreshToken').lean({ virtuals: true });
    sendSuccess(res, account);
  }));
  router.get('/markets', asyncHandler(async (req, res) => {
    const profile = await RunnerProfile.findOne({ accountId: req.user!.sub }).lean();
    if (!profile) throw new HttpError(404, 'Runner profile not found', undefined, 'NOT_FOUND');
    const assignments = await RunnerMarketAssignment.find({ runnerId: profile._id.toString(), status: 'active' }).lean({ virtuals: true });
    const markets = await Market.find({ _id: { $in: assignments.map((item) => item.marketId) }, status: 'active' }).lean({ virtuals: true });
    sendSuccess(res, { assignments, markets });
  }));
  return router;
}

export function createPartnerRouter() {
  const router = Router();
  const auth = new AuthController();
  router.post('/auth/login', validateBody(loginSchema), asyncHandler(auth.partnerLogin));
  router.use(requireAuth, requireAccountType(AccountType.PARTNER));
  router.get('/profile', asyncHandler(async (req, res) => {
    const [account, partner] = await Promise.all([
      User.findById(req.user!.sub).select('-password -refreshToken').lean({ virtuals: true }),
      HookPartner.findOne({ accountId: req.user!.sub }).lean({ virtuals: true }),
    ]);
    if (!partner) throw new HttpError(404, 'Hook Partner profile not found', undefined, 'NOT_FOUND');
    sendSuccess(res, { account, partner });
  }));
  router.patch('/profile', asyncHandler(async (req, res) => {
    const allowed = (({ phone, avatarUrl, preferences }) => ({ phone, avatarUrl, preferences }))(req.body);
    const account = await User.findByIdAndUpdate(req.user!.sub, { $set: allowed }, { returnDocument: 'after' }).select('-password -refreshToken').lean({ virtuals: true });
    sendSuccess(res, account);
  }));
  router.get('/location', asyncHandler(async (req, res) => {
    const partner = await HookPartner.findOne({ accountId: req.user!.sub }).lean({ virtuals: true });
    if (!partner) throw new HttpError(404, 'Hook Partner location not found', undefined, 'NOT_FOUND');
    sendSuccess(res, partner);
  }));
  return router;
}
