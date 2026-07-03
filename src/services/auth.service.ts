import { Repository } from 'typeorm';
import { UserRole } from '@lib/constants';
import { comparePassword, hashPassword } from '@lib/security';
import { Otp } from '@models/auth/otp.model';
import { User } from '@models/users/user.model';
import { HttpError } from '@utils/http';
import { AuthUserPayload, signAccessToken, signRefreshToken } from './token.service';

export class AuthService {
  constructor(
    private readonly userRepo: Repository<User>,
    private readonly otpRepo?: Repository<Otp>,
  ) {}

  async login(email: string, password: string, options?: { adminOnly?: boolean }) {
    const user = await this.userRepo.findOne({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        role: true,
        firstName: true,
        lastName: true,
        isActive: true,
        isEmailVerified: true,
        avatarUrl: true,
      },
    });

    if (!user?.password || !(await comparePassword(password, user.password))) {
      throw new HttpError(401, 'Invalid email or password');
    }

    if (!user.isActive) {
      throw new HttpError(401, 'Account not activated. Complete your profile first.');
    }

    if (
      options?.adminOnly &&
      ![UserRole.ADMIN, UserRole.SUPER_ADMIN].includes(user.role)
    ) {
      throw new HttpError(403, 'Admin access required');
    }

    user.lastLoginAt = new Date();
    const response = this.buildAuthResponse(user);
    await this.userRepo.update(user.id, {
      lastLoginAt: user.lastLoginAt,
      refreshToken: response.refreshToken,
    });

    return response;
  }

  async register(email: string, password: string) {
    const existing = await this.userRepo.findOne({ where: { email } });
    if (existing) {
      throw new HttpError(400, 'An account with this email already exists. Please login.');
    }

    const user = this.userRepo.create({
      email,
      password: await hashPassword(password),
      firstName: '',
      lastName: '',
      role: UserRole.SHOPPER,
      isActive: false,
      isEmailVerified: false,
    });

    await this.userRepo.save(user);
    await this.createOtp(email, 'email_verification');

    return {
      message: 'Verification code sent to your email.',
      email,
      expiresIn: '10 minutes',
    };
  }

  async verifyOtp(email: string, code: string) {
    const otp = await this.findValidOtp(email, code, 'email_verification');
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new HttpError(404, 'User not found');

    otp.isUsed = true;
    user.isEmailVerified = true;
    user.isActive = true;
    await Promise.all([
      this.otpRepo?.save(otp),
      this.userRepo.save(user),
    ]);

    return this.buildAuthResponse(user);
  }

  async completeProfile(userId: string, body: Partial<User>) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new HttpError(404, 'User not found');

    Object.assign(user, {
      firstName: body.firstName ?? user.firstName,
      lastName: body.lastName ?? user.lastName,
      phone: body.phone ?? user.phone,
      avatarUrl: body.avatarUrl ?? user.avatarUrl,
      address: body.address ?? user.address,
      preferences: body.preferences ?? user.preferences,
      isActive: true,
    });

    await this.userRepo.save(user);
    const { password, refreshToken, ...safeUser } = user;
    return safeUser;
  }

  async refresh(refreshToken: string) {
    const user = await this.userRepo.findOne({ where: { refreshToken } });
    if (!user) throw new HttpError(401, 'Invalid refresh token');
    return this.buildAuthResponse(user);
  }

  async requestPasswordReset(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (user) await this.createOtp(email, 'password_reset');
    return { message: 'If the email exists, a password reset code has been sent.' };
  }

  async resetPassword(email: string, code: string, password: string) {
    const otp = await this.findValidOtp(email, code, 'password_reset');
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new HttpError(404, 'User not found');

    otp.isUsed = true;
    user.password = await hashPassword(password);
    user.refreshToken = undefined;
    await Promise.all([
      this.otpRepo?.save(otp),
      this.userRepo.save(user),
    ]);

    return { message: 'Password reset successfully.' };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, password: true },
    });
    if (!user?.password || !(await comparePassword(currentPassword, user.password))) {
      throw new HttpError(400, 'Current password is incorrect');
    }

    await this.userRepo.update(userId, {
      password: await hashPassword(newPassword),
      refreshToken: undefined,
    });
    return { message: 'Password changed successfully.' };
  }

  async getProfile(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new HttpError(404, 'User not found');

    const { password, refreshToken, ...safeUser } = user;
    return safeUser;
  }

  private async createOtp(email: string, type: Otp['type']) {
    if (!this.otpRepo) return;
    const code = process.env.NODE_ENV === 'production'
      ? String(Math.floor(100000 + Math.random() * 900000))
      : '123456';
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await this.otpRepo.save(this.otpRepo.create({ email, code, type, expiresAt }));
  }

  private async findValidOtp(email: string, code: string, type: Otp['type']) {
    if (!this.otpRepo) throw new HttpError(500, 'OTP service is not configured');
    const otp = await this.otpRepo.findOne({
      where: { email, code, type, isUsed: false },
      order: { createdAt: 'DESC' },
    });
    if (!otp || !otp.isValid) throw new HttpError(400, 'Invalid or expired OTP code');
    return otp;
  }

  private buildAuthResponse(user: User) {
    const payload: AuthUserPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatarUrl: user.avatarUrl,
        isEmailVerified: user.isEmailVerified,
      },
    };
  }
}
