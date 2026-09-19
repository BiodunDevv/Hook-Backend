import { Request, Response } from 'express';
import { AccountDeletionService } from '@services/account-deletion.service';
import { HttpError, sendSuccess } from '@utils/http';

/**
 * Public (signed-out) and in-app entry points for account deletion. Both use
 * the same service, so the rules (ownership proof, blockers, cooling-off,
 * cancel) are identical wherever the request comes from.
 */
export class AccountDeletionController {
  private readonly deletions = new AccountDeletionService();

  /** POST /public/account-deletion/code: always the same answer, whether or not the email exists. */
  sendCode = async (req: Request, res: Response) => {
    await this.deletions.sendCode(req.body.email).catch((error) => {
      console.error('[account-deletion] could not send code', error instanceof Error ? error.message : error);
    });
    res.status(202);
    sendSuccess(res, { sent: true }, 'If a Google or Apple account exists for this email, a code is on its way.');
  };

  request = async (req: Request, res: Response) => {
    const { email, password, code, reason } = req.body;
    const user = await this.deletions.verifyOwner(email, { password, code });
    sendSuccess(res, await this.deletions.request(user, { reason, source: 'web' }));
  };

  status = async (req: Request, res: Response) => {
    const { email, password, code } = req.body;
    const user = await this.deletions.verifyOwner(email, { password, code });
    sendSuccess(res, await this.deletions.status(user));
  };

  cancel = async (req: Request, res: Response) => {
    if (req.body.token) return sendSuccess(res, await this.deletions.cancel({ token: req.body.token }));
    const { email, password, code } = req.body;
    const user = await this.deletions.verifyOwner(email, { password, code });
    sendSuccess(res, await this.deletions.cancel({ user }));
  };

  // ── Signed-in (mobile app) ───────────────────────────────────────────────

  requestSignedIn = async (req: Request, res: Response) => {
    if (!req.user?.sub) throw new HttpError(401, 'A registered account is required');
    const { password, code, reason } = req.body;
    const user = await this.deletions.verifySignedIn(req.user.sub, { password, code });
    sendSuccess(res, await this.deletions.request(user, { reason, source: 'app' }));
  };

  statusSignedIn = async (req: Request, res: Response) => {
    if (!req.user?.sub) throw new HttpError(401, 'A registered account is required');
    sendSuccess(res, await this.deletions.status({ id: req.user.sub }));
  };

  /** Signed-in customers who use Google/Apple ask for their code from inside the app. */
  sendCodeSignedIn = async (req: Request, res: Response) => {
    if (!req.user?.email) throw new HttpError(401, 'A registered account is required');
    await this.deletions.sendCode(req.user.email).catch(() => undefined);
    res.status(202);
    sendSuccess(res, { sent: true });
  };
}
