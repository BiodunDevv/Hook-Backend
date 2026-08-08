import type { MongoRepository as Repository } from '@lib/mongo-repository';
import { createHash, randomBytes } from 'crypto';
import { AccountStatus, AccountType, ScopeType, UserRole } from '@lib/constants';
import { comparePassword, hashPassword } from '@lib/security';
import { EmailService } from '@emails/email.service';
import { Otp } from '@models/auth/otp.model';
import { SignupSession } from '@models/auth/signup-session.model';
import { Cart } from '@models/cart/cart.model';
import { DeviceToken } from '@models/notifications/device-token.model';
import { Notification } from '@models/notifications/notification.model';
import { Order } from '@models/orders/order.model';
import { User } from '@models/users/user.model';
import { NotificationService } from '@services/notification.service';
import { HttpError } from '@utils/http';
import { verifyGoogleIdToken } from './google-auth.service';
import {
  issueAccountSession,
  presentAccountUser,
  revokeAccountSession,
  revokeAccountSessions,
  rotateAccountSession,
} from './account-session.service';
import { nextPublicId } from './public-id.service';
import { CartItem } from '@models/cart/cart-item.model';
import { Negotiation } from '@models/negotiations/negotiation.model';
import { NegotiatedQuote } from '@models/catalog/catalog.model';
import { NegotiatedQuoteStatus, NegotiationStatus } from '@lib/constants';
import { GuestSession } from '@models/platform/session.model';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  private readonly notifications?: NotificationService;

  constructor(
    private readonly userRepo: Repository<User>,
    private readonly otpRepo?: Repository<Otp>,
    private readonly email = new EmailService(),
    private readonly signupSessions?: Repository<SignupSession>,
    private readonly carts?: Repository<Cart>,
    private readonly orders?: Repository<Order>,
    deviceTokens?: Repository<DeviceToken>,
    notifications?: Repository<Notification>,
  ) {
    if (deviceTokens && notifications) {
      this.notifications = new NotificationService(deviceTokens, notifications);
    }
  }

  async lookup(email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const existing = await this.userRepo.findOne({ where: { email: normalizedEmail } });
    if (existing) {
      return {
        email: normalizedEmail,
        exists: true,
        nextStep: 'password',
        message: 'Continue with your password.',
      };
    }

    const session = await this.signupSessions?.findOne({
      where: { email: normalizedEmail },
      order: { createdAt: 'DESC' },
    });

    if (session && new Date(session.expiresAt) > new Date()) {
      return {
        email: normalizedEmail,
        exists: false,
        nextStep: session.isEmailVerified ? 'complete_profile' : 'verify_email',
        signupSessionToken: undefined,
        message: 'Continue creating your account.',
      };
    }

    return {
      email: normalizedEmail,
      exists: false,
      nextStep: 'create_password',
      message: 'Create a password to continue.',
    };
  }

  async login(email: string, password: string, options?: {
    guestId?: string;
  }) {
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
        publicId: true,
        accountType: true,
        accountStatus: true,
      },
    });

    if (!user?.password || !(await comparePassword(password, user.password))) {
      throw new HttpError(401, 'Invalid email or password');
    }

    if (!user.isActive) {
      throw new HttpError(401, 'Account not activated. Complete your profile first.');
    }
    if (user.accountStatus === 'pending_password') {
      throw new HttpError(403, 'Set your password from the email sent after checkout before signing in');
    }
    if (user.accountStatus && user.accountStatus !== AccountStatus.ACTIVE) {
      throw new HttpError(403, 'This account is not available for sign in', undefined, 'ACCESS_DENIED');
    }

    user.lastLoginAt = new Date();
    const response = await this.buildAuthResponse(user);
    if (options?.guestId) await this.mergeGuestIntoUser(options.guestId, user.id);
    await this.userRepo.update(user.id, {
      lastLoginAt: user.lastLoginAt,
      refreshToken: undefined,
    });
    await this.notifications?.sendWelcome(
      { userId: user.id },
      `${user.firstName || ''} ${user.lastName || ''}`.trim() || undefined,
    );

    return response;
  }

  async loginWithGoogle(input: { idToken: string; guestId?: string }) {
    const payload = await verifyGoogleIdToken(input.idToken);
    const email = payload.email!.toLowerCase().trim();
    const firstName = payload.given_name || '';
    const lastName = payload.family_name || '';
    const avatarUrl = payload.picture;

    let user = await this.userRepo.findOne({ where: [{ email }, { googleId: payload.sub }] });
    const isNewUser = !user;

    if (user) {
      if (!user.isActive || (user.accountStatus && user.accountStatus !== AccountStatus.ACTIVE)) {
        throw new HttpError(403, 'This account is not available for sign in', undefined, 'ACCESS_DENIED');
      }
      user.googleId = user.googleId || payload.sub;
      user.email = user.email || email;
      user.authProvider = user.authProvider === 'google' ? 'google' : user.authProvider || 'password';
      user.firstName = user.firstName || firstName;
      user.lastName = user.lastName || lastName;
      user.avatarUrl = user.avatarUrl || avatarUrl;
      user.isEmailVerified = true;
      user.lastLoginAt = new Date();
      await this.userRepo.save(user);
    } else {
      user = await this.userRepo.save(this.userRepo.create({
        publicId: await nextPublicId('customer'),
        accountType: AccountType.CUSTOMER,
        accountStatus: AccountStatus.ACTIVE,
        scopeType: ScopeType.SELF,
        email,
        password: undefined,
        authProvider: 'google',
        googleId: payload.sub,
        firstName,
        lastName,
        avatarUrl,
        role: UserRole.SHOPPER,
        isActive: true,
        isEmailVerified: true,
        isPhoneVerified: false,
        lastLoginAt: new Date(),
      }));
    }

    if (!user) throw new HttpError(401, 'Google sign-in could not be completed');
    const authUser = user;
    const response = await this.buildAuthResponse(authUser);
    await Promise.all([
      this.userRepo.update(authUser.id, { refreshToken: undefined, lastLoginAt: new Date() }),
      this.mergeGuestIntoUser(input.guestId, authUser.id),
    ]);

    const name = `${authUser.firstName || ''} ${authUser.lastName || ''}`.trim();
    await Promise.allSettled([
      isNewUser ? this.email.sendWelcome({ email: authUser.email, name }) : Promise.resolve(),
      this.notifications?.sendWelcome({ userId: authUser.id }, name || undefined),
    ]);

    return response;
  }

  async register(email: string, password: string) {
    const existing = await this.userRepo.findOne({ where: { email } });
    if (existing) {
      throw new HttpError(400, 'An account with this email already exists. Please login.');
    }

    const user = this.userRepo.create({
      publicId: await nextPublicId('customer'),
      accountType: AccountType.CUSTOMER,
      accountStatus: AccountStatus.ACTIVE,
      scopeType: ScopeType.SELF,
      email,
      password: await hashPassword(password),
      authProvider: 'password',
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

  async startSignup(email: string, password: string, guestId?: string) {
    if (!this.signupSessions) throw new HttpError(500, 'Signup sessions are not configured');
    const normalizedEmail = email.toLowerCase().trim();
    const existing = await this.userRepo.findOne({ where: { email: normalizedEmail } });
    if (existing) throw new HttpError(400, 'An account with this email already exists. Please login.');

    const rawToken = randomBytes(32).toString('hex');
    const expiresInMinutes = Number(process.env.SIGNUP_SESSION_EXPIRY_MINUTES || 30);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    const previous = await this.signupSessions.findOne({ where: { email: normalizedEmail }, order: { createdAt: 'DESC' } });
    if (previous) await this.signupSessions.delete({ id: previous.id });

    const session = await this.signupSessions.save(this.signupSessions.create({
      email: normalizedEmail,
      passwordHash: await hashPassword(password),
      sessionTokenHash: hashToken(rawToken),
      isEmailVerified: false,
      currentStep: 'password_created',
      guestId,
      expiresAt,
    }));

    await this.createOtp(normalizedEmail, 'email_verification');

    return {
      email: normalizedEmail,
      signupSessionToken: rawToken,
      nextStep: 'verify_email',
      expiresAt: session.expiresAt,
      message: 'Verification code sent to your email.',
    };
  }

  async verifySignup(sessionToken: string, code: string) {
    const session = await this.findSignupSession(sessionToken);
    const otp = await this.findValidOtp(session.email, code, 'email_verification');
    await Promise.all([
      this.markOtpUsed(otp.id),
      this.signupSessions!.update(session.id, {
        isEmailVerified: true,
        currentStep: 'email_verified',
      }),
    ]);
    return {
      email: session.email,
      signupSessionToken: sessionToken,
      nextStep: 'complete_profile',
      message: 'Email verified.',
    };
  }

  async resendSignupCode(sessionToken: string) {
    const session = await this.findSignupSession(sessionToken);
    if (session.isEmailVerified) {
      return {
        email: session.email,
        signupSessionToken: sessionToken,
        nextStep: 'complete_profile',
        message: 'Email is already verified.',
      };
    }

    await this.createOtp(session.email, 'email_verification');
    return {
      email: session.email,
      signupSessionToken: sessionToken,
      nextStep: 'verify_email',
      message: 'A new verification code has been sent.',
    };
  }

  async completeSignup(sessionToken: string, body: Partial<User> & { guestId?: string }) {
    const session = await this.findSignupSession(sessionToken);
    if (!session.isEmailVerified) throw new HttpError(400, 'Verify your email before completing signup');
    const existing = await this.userRepo.findOne({ where: { email: session.email } });
    if (existing) throw new HttpError(400, 'An account with this email already exists. Please login.');

    const user = await this.userRepo.save(this.userRepo.create({
      publicId: await nextPublicId('customer'),
      accountType: AccountType.CUSTOMER,
      accountStatus: AccountStatus.ACTIVE,
      scopeType: ScopeType.SELF,
      email: session.email,
      password: session.passwordHash,
      authProvider: 'password',
      firstName: body.firstName || '',
      lastName: body.lastName || '',
      phone: body.phone,
      avatarUrl: body.avatarUrl,
      address: body.address,
      preferences: body.preferences,
      role: UserRole.SHOPPER,
      isActive: true,
      isEmailVerified: true,
      isPhoneVerified: false,
      lastLoginAt: new Date(),
    }));

    const response = await this.buildAuthResponse(user);
    await Promise.all([
      this.userRepo.update(user.id, { refreshToken: undefined }),
      this.signupSessions!.delete({ id: session.id }),
      this.mergeGuestIntoUser(body.guestId || session.guestId, user.id),
    ]);
    const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    await Promise.all([
      this.email.sendWelcome({ email: user.email, name }),
      this.notifications?.sendWelcome({ userId: user.id }, name),
    ]);

    return response;
  }

  async verifyOtp(email: string, code: string) {
    const otp = await this.findValidOtp(email, code, 'email_verification');
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new HttpError(404, 'User not found');

    user.isEmailVerified = true;
    user.isActive = true;
    await Promise.all([
      this.markOtpUsed(otp.id),
      this.userRepo.save(user),
    ]);
    await this.email.sendWelcome({
      email: user.email,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    });

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
    return rotateAccountSession(refreshToken);
  }

  async logout(refreshToken?: string, _userId?: string, sessionId?: string) {
    await revokeAccountSession(refreshToken, sessionId);
    return { loggedOut: true };
  }

  async requestPasswordReset(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (user) await this.createOtp(email, 'password_reset');
    return { message: 'If the email exists, a password reset code has been sent.' };
  }

  async verifyPasswordReset(email: string, code: string) {
    await this.findValidOtp(email, code, 'password_reset');
    return { email, resetToken: code, message: 'Code verified.' };
  }

  async requestAdminPasswordReset(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (
      user &&
      [UserRole.SUPPORT, UserRole.ADMIN, UserRole.SUPER_ADMIN].includes(user.role) &&
      user.isActive
    ) {
      await this.createOtp(email, 'password_reset');
    }
    return { message: 'If the admin email exists, a password reset code has been sent.' };
  }

  async resetPassword(email: string, code: string, password: string) {
    const otp = await this.findValidOtp(email, code, 'password_reset');
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new HttpError(404, 'User not found');

    user.password = await hashPassword(password);
    user.refreshToken = undefined;
    user.accountStatus = AccountStatus.ACTIVE;
    user.isActive = true;
    user.isEmailVerified = true;
    await Promise.all([
      this.markOtpUsed(otp.id),
      this.userRepo.save(user),
    ]);

    await revokeAccountSessions(user.id, 'password_reset');
    const response = await this.buildAuthResponse(user);
    await this.notifications?.sendWelcome(
      { userId: user.id },
      `${user.firstName || ''} ${user.lastName || ''}`.trim() || undefined,
    );
    return { message: 'Password reset successfully.', ...response };
  }

  async resetAdminPassword(email: string, code: string, password: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (
      !user ||
      ![UserRole.SUPPORT, UserRole.ADMIN, UserRole.SUPER_ADMIN].includes(user.role) ||
      !user.isActive
    ) {
      throw new HttpError(400, 'Invalid or expired OTP code');
    }
    return this.resetPassword(email, code, password);
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
    return presentAccountUser(user);
  }

  private async createOtp(email: string, type: Otp['type']) {
    if (!this.otpRepo) return;
    const normalizedEmail = email.toLowerCase().trim();
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const expiresInMinutes = Number(process.env.OTP_EXPIRY_MINUTES || 10);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
    await this.otpRepo.update({ email: normalizedEmail, type, isUsed: false }, { isUsed: true });
    await this.otpRepo.save(this.otpRepo.create({ email: normalizedEmail, code, type, expiresAt }));
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[otp:dev] ${type} for ${normalizedEmail}: ${code} (expires in ${expiresInMinutes}m)`);
    }
    await this.email.sendOtp({
      email: normalizedEmail,
      code,
      purpose: type === 'password_reset' ? 'password_reset' : 'verification',
      expiresInMinutes,
    });
  }

  private async findSignupSession(sessionToken: string) {
    if (!this.signupSessions) throw new HttpError(500, 'Signup sessions are not configured');
    const session = await this.signupSessions.findOne({ where: { sessionTokenHash: hashToken(sessionToken) } });
    if (!session || new Date(session.expiresAt) <= new Date()) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[auth:verify] signup session not found or expired');
      }
      throw new HttpError(400, 'Signup session expired. Please start again.');
    }
    return session;
  }

  private async mergeGuestIntoUser(guestId: string | undefined, userId: string) {
    if (!guestId) return;
    const guestCart = await Cart.findOne({ guestSessionId: guestId, status: 'active', isCheckedOut: false });
    const customerCart = await Cart.findOne({ customerId: userId, status: 'active', isCheckedOut: false });
    if (guestCart && !customerCart) {
      guestCart.ownerType = 'customer'; guestCart.customerId = userId; guestCart.guestSessionId = undefined; guestCart.version = Number(guestCart.version || 1) + 1; await guestCart.save();
    } else if (guestCart && customerCart) {
      const guestItems = await CartItem.find({ cartId: guestCart.id });
      for (const item of guestItems) {
        const existing = await CartItem.findOne({ cartId: customerCart.id, productId: item.productId, variantKey: item.variantKey });
        if (existing) {
          existing.quantity = Math.min(99, existing.quantity + item.quantity);
          existing.quoteId = undefined; existing.quoteVersion = undefined;
          existing.totalPriceMinor = existing.quantity * Number(existing.unitPriceMinor || 0);
          existing.totalPrice = Number(existing.totalPriceMinor) / 100; await existing.save(); await item.deleteOne();
        } else { item.cartId = customerCart.id; await item.save(); }
      }
      guestCart.status = 'converted'; guestCart.isCheckedOut = true; await guestCart.save();
      customerCart.version = Number(customerCart.version || 1) + 1; await customerCart.save();
    }
    const negotiations = await Negotiation.find({ guestSessionId: guestId, status: { $in: [NegotiationStatus.ACTIVE, NegotiationStatus.AGREED, NegotiationStatus.ACCEPTED] } });
    for (const negotiation of negotiations) {
      negotiation.customerId = userId; negotiation.guestSessionId = undefined;
      if ([NegotiationStatus.AGREED, NegotiationStatus.ACCEPTED].includes(negotiation.status) && negotiation.agreedPriceMinor && negotiation.variantId && negotiation.expiresAt && negotiation.expiresAt > new Date() && !negotiation.quoteId) {
        const quote = await NegotiatedQuote.create({ publicId: await nextPublicId('quote'), negotiationId: negotiation.id, customerId: userId, productId: negotiation.productId, variantId: negotiation.variantId, quantity: negotiation.quantity, currency: negotiation.currency, originalPriceMinor: negotiation.rulesSnapshot?.sellingPriceMinor || negotiation.agreedPriceMinor, agreedPriceMinor: negotiation.agreedPriceMinor, expiresAt: negotiation.expiresAt, status: NegotiatedQuoteStatus.ACTIVE, version: 1 });
        negotiation.quoteId = quote.id;
      }
      await negotiation.save();
    }
    await GuestSession.updateOne({ _id: guestId, revokedAt: null }, { $set: { convertedAccountId: userId, revokedAt: new Date() } });
  }

  private async findValidOtp(email: string, code: string, type: Otp['type']) {
    if (!this.otpRepo) throw new HttpError(500, 'OTP service is not configured');
    const normalizedEmail = email.toLowerCase().trim();
    const now = new Date();
    const otp = await this.otpRepo.model
      .findOne({
        email: normalizedEmail,
        code,
        type,
        isUsed: false,
        expiresAt: { $gt: now },
      })
      .sort({ createdAt: -1 })
      .lean({ virtuals: true });
    if (!otp) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[auth:verify] otp not found or expired for ${normalizedEmail} (${type})`);
      }
      throw new HttpError(400, 'Invalid or expired OTP code');
    }
    return otp;
  }

  private async markOtpUsed(id: string) {
    if (!this.otpRepo) throw new HttpError(500, 'OTP service is not configured');
    await this.otpRepo.update(id, { isUsed: true });
  }

  private buildAuthResponse(user: User) {
    return issueAccountSession(user);
  }
}
