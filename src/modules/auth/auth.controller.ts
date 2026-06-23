import { Controller, Post, Get, Patch, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  RegisterDto, VerifyOtpDto, CompleteProfileDto, SocialLoginDto, LoginDto,
  ChangePasswordDto, RefreshTokenDto, RequestOtpDto,
  ForgotPasswordDto, VerifyResetOtpDto, ResetPasswordDto,
} from './dto/auth.dto';
import { CurrentUser, Public } from '@common/decorators';
import { success, created } from '@common/dto/api-response.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Step 1: Create account with email + password — sends OTP' })
  async register(@Body() dto: RegisterDto) {
    return created(
      await this.authService.register(dto),
      'Verification code sent to your email',
    );
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 2: Verify email with OTP code' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return success(await this.authService.verifyOtp(dto));
  }

  @Public()
  @Post('complete-profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 3: Set your name and activate account' })
  async completeProfile(@Body() dto: CompleteProfileDto) {
    return success(
      await this.authService.completeProfile(dto),
      'Account activated successfully',
    );
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(@Body() dto: LoginDto) {
    return success(
      await this.authService.login(dto.email, dto.password),
    );
  }

  @Public()
  @Post('social')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign up or sign in with Google / Apple' })
  async socialLogin(@Body() dto: SocialLoginDto) {
    return success(
      await this.authService.socialLogin(dto),
      `Signed in with ${dto.provider}`,
    );
  }

  @ApiBearerAuth()
  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password (requires current password)' })
  async changePassword(
    @CurrentUser('sub') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return success(
      await this.authService.changePassword(userId, dto.currentPassword, dto.newPassword),
    );
  }

  @ApiBearerAuth()
  @Get('profile')
  @ApiOperation({ summary: 'Get my profile' })
  async getProfile(@CurrentUser('sub') userId: string) {
    return success(await this.authService.getProfile(userId));
  }

  @ApiBearerAuth()
  @Patch('profile')
  @ApiOperation({ summary: 'Update my profile' })
  async updateProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: { firstName?: string; lastName?: string; phone?: string; avatarUrl?: string },
  ) {
    return success(await this.authService.updateProfile(userId, dto));
  }

  @Public()
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend verification code' })
  async resendOtp(@Body() dto: RequestOtpDto) {
    return success(
      await this.authService.resendOtp(dto.email),
      'Code resent',
    );
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 1: Send OTP to email for password reset' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return success(
      await this.authService.forgotPassword(dto),
      'If account exists, reset code sent',
    );
  }

  @Public()
  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 2: Verify OTP for password reset' })
  async verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
    return success(await this.authService.verifyResetOtp(dto));
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 3: Reset password with new password and confirm' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return success(
      await this.authService.resetPassword(dto),
      'Password reset successful',
    );
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    return success(await this.authService.refreshToken(dto.refreshToken));
  }
}
