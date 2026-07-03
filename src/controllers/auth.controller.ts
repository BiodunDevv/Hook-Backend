import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { Otp } from '@models/auth/otp.model';
import { User } from '@models/users/user.model';
import { AuthService } from '@services/auth.service';
import { sendCreated, sendSuccess } from '@utils/http';

export class AuthController {
  private readonly auth = new AuthService(
    AppDataSource.getRepository(User),
    AppDataSource.getRepository(Otp),
  );

  register = async (req: Request, res: Response) => {
    const result = await this.auth.register(req.body.email, req.body.password);
    sendCreated(res, result, 'Verification code sent to your email');
  };

  login = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.login(req.body.email, req.body.password));
  };

  adminLogin = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await this.auth.login(req.body.email, req.body.password, { adminOnly: true }),
    );
  };

  profile = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.getProfile(req.user!.sub));
  };

  updateProfile = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.completeProfile(req.user!.sub, req.body));
  };

  verifyOtp = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.verifyOtp(req.body.email, req.body.code));
  };

  completeProfile = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.completeProfile(req.user!.sub, req.body));
  };

  refresh = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.refresh(req.body.refreshToken));
  };

  requestPasswordReset = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.requestPasswordReset(req.body.email));
  };

  resetPassword = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.resetPassword(req.body.email, req.body.code, req.body.password));
  };

  changePassword = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.changePassword(req.user!.sub, req.body.currentPassword, req.body.newPassword));
  };
}
