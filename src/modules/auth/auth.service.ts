import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { User } from '@modules/users/entities/user.entity';
import { Otp } from './entities/otp.entity';
import { RequestSignupOtpDto, VerifySignupOtpDto, SocialLoginDto, SetPasswordDto, ChangePasswordDto } from './dto/auth.dto';
import { JwtPayload } from '@common/interfaces';
import { UserRole } from '@common/constants';
import { hashPassword, comparePassword, generateOtp } from '@common/helpers';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Otp) private otpRepo: Repository<Otp>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  // =======================================================
  // STEP 1: REQUEST OTP — send code to email or phone
  // =======================================================
  async requestSignupOtp(dto: RequestSignupOtpDto) {
    const identifier = dto.email || dto.phone!;
    const channel = dto.email ? 'email' : 'phone';
    const code = generateOtp(6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.otpRepo.save({
      email: identifier,
      code,
      type: 'email_verification',
      expiresAt,
    });

    this.logger.log(`[OTP] ${channel} → ${identifier}: ${code}`);

    // TODO: Send via SendGrid (email) or Termii (SMS)
    // if (channel === 'email') this.sendGridService.sendOtp(identifier, code)
    // if (channel === 'phone') this.termiiService.sendOtp(identifier, code)

    return {
      message: `Verification code sent to your ${channel}`,
      identifier,
      channel,
      expiresIn: '10 minutes',
      // ⚠️ Remove in production: only for dev/testing
      debugCode: process.env.NODE_ENV === 'development' ? code : undefined,
    };
  }

  // =======================================================
  // STEP 2: VERIFY OTP → create account (or login if exists)
  // =======================================================
  async verifySignupOtp(dto: VerifySignupOtpDto) {
    const identifier = dto.email || dto.phone!;

    // Validate OTP
    const otp = await this.otpRepo.findOne({
      where: { email: identifier, code: dto.otp, isUsed: false },
    });
    if (!otp || !otp.isValid) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    otp.isUsed = true;
    await this.otpRepo.save(otp);

    // Check if user already exists
    let user = dto.email
      ? await this.userRepo.findOne({ where: { email: dto.email } })
      : null;

    if (user) {
      // Existing user — just log them in
      user.lastLoginAt = new Date();
      await this.userRepo.update(user.id, { lastLoginAt: user.lastLoginAt });
      this.logger.log(`[Auth] Existing user logged in via OTP: ${identifier}`);
      return this.buildAuthResponse(user, false);
    }

    // New user — create account
    const userData: Partial<User> = {
      role: UserRole.SHOPPER as any,
      isEmailVerified: true,
    };

    if (dto.email) {
      userData.email = dto.email;
    }
    if (dto.phone) {
      userData.phone = dto.phone;
      userData.isPhoneVerified = true;
    }
    if (dto.firstName) {
      userData.firstName = dto.firstName;
    }
    if (dto.lastName) {
      userData.lastName = dto.lastName;
    }

    user = this.userRepo.create(userData);
    await this.userRepo.save(user);

    this.logger.log(`[Auth] New user created via OTP: ${identifier}`);
    return this.buildAuthResponse(user, true);
  }

  // =======================================================
  // SOCIAL LOGIN — Google / Apple
  // =======================================================
  async socialLogin(dto: SocialLoginDto) {
    const email = dto.email;
    if (!email) {
      throw new BadRequestException('Email is required from social login');
    }

    let user = await this.userRepo.findOne({ where: { email } });
    const wasNewUser = !user;

    if (!user) {
      user = this.userRepo.create({
        email,
        firstName: dto.firstName || 'User',
        lastName: dto.lastName || '',
        role: UserRole.SHOPPER as any,
        isEmailVerified: true,
        isPhoneVerified: false,
      });
      await this.userRepo.save(user);
      this.logger.log(`[Auth] New user via ${dto.provider}: ${email}`);
    }

    user.lastLoginAt = new Date();
    await this.userRepo.update(user.id, { lastLoginAt: new Date() });
    return this.buildAuthResponse(user, wasNewUser);
  }

  // =======================================================
  // SET PASSWORD — for users who want password login later
  // =======================================================
  async setPassword(userId: string, password: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'password'],
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.password) {
      throw new BadRequestException('Password already set. Use change password instead.');
    }
    const hashed = await hashPassword(password);
    await this.userRepo.update(userId, { password: hashed });
    return { message: 'Password set successfully' };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'password'],
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.password) {
      throw new BadRequestException('No password set. Use set password instead.');
    }
    if (!(await comparePassword(currentPassword, user.password))) {
      throw new BadRequestException('Current password is incorrect');
    }
    const hashed = await hashPassword(newPassword);
    await this.userRepo.update(userId, { password: hashed });
    return { message: 'Password changed successfully' };
  }

  async passwordLogin(email: string, password: string) {
    const user = await this.userRepo.findOne({
      where: { email },
      select: ['id', 'email', 'password', 'role', 'firstName', 'lastName', 'isActive', 'avatarUrl', 'phone', 'isEmailVerified', 'isPhoneVerified'],
    });

    if (!user || !user.password || !(await comparePassword(password, user.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account deactivated');
    }
    user.lastLoginAt = new Date();
    await this.userRepo.update(user.id, { lastLoginAt: user.lastLoginAt });
    return this.buildAuthResponse(user, false);
  }

  // =======================================================
  // PROFILE
  // =======================================================
  async getProfile(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['vendors'],
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, data: { firstName?: string; lastName?: string; phone?: string; avatarUrl?: string }) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    Object.assign(user, data);
    await this.userRepo.save(user);
    return this.getProfile(userId);
  }

  // =======================================================
  // RESEND OTP
  // =======================================================
  async resendOtp(identifier: string) {
    return this.requestSignupOtp(
      identifier.includes('@')
        ? { email: identifier }
        : { phone: identifier }
    );
  }

  // =======================================================
  // REFRESH TOKEN
  // =======================================================
  async refreshToken(refreshToken: string) {
    try {
      const decoded = this.jwtService.verify(refreshToken) as JwtPayload;
      const user = await this.userRepo.findOne({ where: { id: decoded.sub } });
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Invalid token');
      }
      return this.buildTokens({ sub: user.id, email: user.email, role: user.role });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  // =======================================================
  // HELPERS
  // =======================================================

  private buildAuthResponse(user: User, isNewUser = false) {
    const payload: JwtPayload = { sub: user.id, email: user.email || user.phone || '', role: user.role };
    const tokens = this.buildTokens(payload);
    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified,
        avatarUrl: user.avatarUrl,
        isNewUser,
      },
      ...tokens,
    };
  }

  private buildTokens(payload: JwtPayload) {
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_EXPIRY', '7d'),
    });
    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRY', '30d'),
    });
    return { accessToken, refreshToken };
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanExpiredOtps() {
    const result = await this.otpRepo.delete({ expiresAt: LessThan(new Date()) });
    if (result.affected && result.affected > 0) {
      this.logger.log(`Cleaned ${result.affected} expired OTPs`);
    }
  }
}
