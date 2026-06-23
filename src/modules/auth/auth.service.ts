import {
  Injectable,
  UnauthorizedException,
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
import { RegisterDto, VerifyOtpDto, CompleteProfileDto, SocialLoginDto, ChangePasswordDto, ForgotPasswordDto, VerifyResetOtpDto, ResetPasswordDto } from './dto/auth.dto';
import { BrevoService } from '@integrations/brevo/brevo.service';
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
    private brevoService: BrevoService,
  ) {}

  // =======================================================
  // STEP 1: REGISTER — email + password → sends OTP
  // =======================================================
  async register(dto: RegisterDto) {
    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new BadRequestException('An account with this email already exists. Please login.');
    }

    const hashed = await hashPassword(dto.password);

    // Create user without name (name is set after OTP verification)
    const user = this.userRepo.create({
      email: dto.email,
      password: hashed,
      firstName: '',
      lastName: '',
      role: UserRole.SHOPPER as any,
      isEmailVerified: false,
      isActive: false,
    });
    await this.userRepo.save(user);

    // Generate and save OTP
    const code = generateOtp(6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.otpRepo.save({
      email: dto.email,
      code,
      type: 'email_verification',
      expiresAt,
    });

    this.logger.log(`[Register] User created: ${dto.email}, OTP: ${code}`);

    await this.brevoService.sendOtp(dto.email, code);

    return {
      message: 'Verification code sent to your email.',
      email: dto.email,
      expiresIn: '10 minutes',
      code,
    };
  }

  // =======================================================
  // STEP 2: VERIFY OTP — validates code only
  // =======================================================
  async verifyOtp(dto: VerifyOtpDto) {
    const otp = await this.otpRepo.findOne({
      where: { email: dto.email, code: dto.code, isUsed: false },
    });
    if (!otp || !otp.isValid) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    otp.isUsed = true;
    await this.otpRepo.save(otp);

    // Mark email as verified
    await this.userRepo.update(
      { email: dto.email },
      { isEmailVerified: true },
    );

    this.logger.log(`[Verify OTP] Email verified: ${dto.email}`);

    return {
      message: 'Email verified successfully. Please complete your profile.',
      email: dto.email,
    };
  }

  // =======================================================
  // STEP 3: COMPLETE PROFILE — sets name & activates account
  // =======================================================
  async completeProfile(dto: CompleteProfileDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user) {
      throw new BadRequestException('User not found. Please register first.');
    }
    if (!user.isEmailVerified) {
      throw new BadRequestException('Email not verified yet. Please verify your OTP first.');
    }
    if (user.isActive) {
      throw new BadRequestException('Account already active. Please login.');
    }

    user.firstName = dto.firstName;
    user.lastName = dto.lastName;
    user.isActive = true;
    await this.userRepo.save(user);

    this.logger.log(`[Complete Profile] User activated: ${dto.email} (${dto.firstName} ${dto.lastName})`);

    return this.buildAuthResponse(user);
  }

  // =======================================================
  // LOGIN — email + password
  // =======================================================
  async login(email: string, password: string) {
    const user = await this.userRepo.findOne({
      where: { email },
      select: ['id', 'email', 'password', 'role', 'firstName', 'lastName', 'isActive', 'isEmailVerified', 'avatarUrl'],
    });

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account not activated. Complete your profile first.');
    }
    if (!(await comparePassword(password, user.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    user.lastLoginAt = new Date();
    await this.userRepo.update(user.id, { lastLoginAt: user.lastLoginAt });

    return this.buildAuthResponse(user);
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
    const isNewUser = !user;

    if (!user) {
      user = this.userRepo.create({
        email,
        firstName: dto.firstName || 'User',
        lastName: dto.lastName || '',
        role: UserRole.SHOPPER as any,
        isEmailVerified: true,
        isActive: true,
      });
      await this.userRepo.save(user);
      this.logger.log(`[Social] New user via ${dto.provider}: ${email}`);
    }

    user.lastLoginAt = new Date();
    await this.userRepo.update(user.id, { lastLoginAt: new Date() });
    return { isNewUser, ...this.buildAuthResponse(user) };
  }

  // =======================================================
  // CHANGE PASSWORD
  // =======================================================
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'password'],
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.password) {
      throw new BadRequestException('No password set. Use social login.');
    }
    if (!(await comparePassword(currentPassword, user.password))) {
      throw new BadRequestException('Current password is incorrect');
    }
    const hashed = await hashPassword(newPassword);
    await this.userRepo.update(userId, { password: hashed });
    return { message: 'Password changed successfully' };
  }

  // =======================================================
  // RESEND OTP
  // =======================================================
  async resendOtp(email: string) {
    const code = generateOtp(6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.otpRepo.save({ email, code, type: 'email_verification', expiresAt });

    this.logger.log(`[Resend OTP] ${email}: ${code}`);

    await this.brevoService.sendOtp(email, code);

    return {
      message: 'Verification code resent to your email',
      email,
      expiresIn: '10 minutes',
      code,
    };
  }

  // =======================================================
  // STEP 4: FORGOT PASSWORD — sends OTP for password reset
  // =======================================================
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user) {
      // Don't reveal whether the email exists — security best practice
      return {
        message: 'If an account with this email exists, a reset code has been sent.',
        email: dto.email,
      };
    }

    const code = generateOtp(6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.otpRepo.save({
      email: dto.email,
      code,
      type: 'password_reset',
      expiresAt,
    });

    this.logger.log(`[Forgot Password] OTP sent to ${dto.email}: ${code}`);
    await this.brevoService.sendTemplate('otp', dto.email, { code });

    return {
      message: 'If an account with this email exists, a reset code has been sent.',
      email: dto.email,
      expiresIn: '10 minutes',
      code,
    };
  }

  // =======================================================
  // STEP 5: VERIFY RESET OTP — validates reset code
  // =======================================================
  async verifyResetOtp(dto: VerifyResetOtpDto) {
    const otp = await this.otpRepo.findOne({
      where: { email: dto.email, code: dto.code, isUsed: false, type: 'password_reset' },
    });
    if (!otp || !otp.isValid) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    otp.isUsed = true;
    await this.otpRepo.save(otp);

    this.logger.log(`[Verify Reset OTP] Email verified: ${dto.email}`);

    return {
      message: 'Email verified successfully. You can now reset your password.',
      email: dto.email,
    };
  }

  // =======================================================
  // STEP 6: RESET PASSWORD — updates password in DB
  // =======================================================
  async resetPassword(dto: ResetPasswordDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const user = await this.userRepo.findOne({
      where: { email: dto.email },
      select: ['id', 'email', 'password'],
    });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const hashed = await hashPassword(dto.newPassword);
    await this.userRepo.update(user.id, { password: hashed });

    this.logger.log(`[Reset Password] Password updated for ${dto.email}`);

    return {
      message: 'Password reset successful. You can now login with your new password.',
    };
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

  private buildAuthResponse(user: User) {
    const payload: JwtPayload = { sub: user.id, email: user.email || '', role: user.role };
    const tokens = this.buildTokens(payload);
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        avatarUrl: user.avatarUrl,
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
