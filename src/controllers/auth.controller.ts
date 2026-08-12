import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { Otp } from '@models/auth/otp.model';
import { SignupSession } from '@models/auth/signup-session.model';
import { Cart } from '@models/cart/cart.model';
import { DeviceToken } from '@models/notifications/device-token.model';
import { Notification } from '@models/notifications/notification.model';
import { Order } from '@models/orders/order.model';
import { User } from '@models/users/user.model';
import { AuthService } from '@services/auth.service';
import { sendCreated, sendSuccess } from '@utils/http';

export class AuthController {
  private readonly auth = new AuthService(
    AppDataSource.getRepository(User),
    AppDataSource.getRepository(Otp),
    undefined,
    AppDataSource.getRepository(SignupSession),
    AppDataSource.getRepository(Cart),
    AppDataSource.getRepository(Order),
    AppDataSource.getRepository(DeviceToken),
    AppDataSource.getRepository(Notification),
  );

  lookup = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.lookup(req.body.email));
  };

  register = async (req: Request, res: Response) => {
    const result = await this.auth.register(req.body.email, req.body.password);
    sendCreated(res, result, 'Verification code sent to your email');
  };

  login = async (req: Request, res: Response) => {
    const portal = req.header('x-hook-portal') === 'staff' ? 'staff' : 'customer';
    sendSuccess(res, await this.auth.login(req.body.email, req.body.password, portal));
  };

  googleLogin = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.loginWithGoogle({
      idToken: req.body.idToken,
    }));
  };

  appleLogin = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.loginWithApple(req.body));
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

  startSignup = async (req: Request, res: Response) => {
    sendCreated(res, await this.auth.startSignup(req.body.email, req.body.password), 'Verification code sent to your email');
  };

  verifySignup = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.verifySignup(req.body.signupSessionToken, req.body.code));
  };

  resendSignupCode = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.resendSignupCode(req.body.signupSessionToken));
  };

  completeSignup = async (req: Request, res: Response) => {
    sendCreated(res, await this.auth.completeSignup(req.body.signupSessionToken, req.body), 'Account created successfully');
  };

  completeProfile = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.completeProfile(req.user!.sub, req.body));
  };

  refresh = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.refresh(req.body.refreshToken));
  };

  logout = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.logout(req.body.refreshToken, req.user?.sub, req.user?.sid));
  };

  requestPasswordReset = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.requestPasswordReset(req.body.email));
  };

  verifyPasswordReset = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.verifyPasswordReset(req.body.email, req.body.code));
  };

  resetPassword = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.resetPassword(req.body.email, req.body.code, req.body.password));
  };

  requestAdminPasswordReset = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.requestAdminPasswordReset(req.body.email));
  };

  resetAdminPassword = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.resetAdminPassword(req.body.email, req.body.code, req.body.password));
  };

  changePassword = async (req: Request, res: Response) => {
    sendSuccess(res, await this.auth.changePassword(req.user!.sub, req.body.currentPassword, req.body.newPassword));
  };
}
