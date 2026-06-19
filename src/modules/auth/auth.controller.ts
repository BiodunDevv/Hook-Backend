import { Controller, Post, Get, Patch, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  RequestSignupOtpDto, VerifySignupOtpDto, SocialLoginDto, LoginDto,
  SetPasswordDto, ChangePasswordDto, RefreshTokenDto,
} from './dto/auth.dto';
import { CurrentUser, Public } from '@common/decorators';
import { success, created } from '@common/dto/api-response.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ========================================================
  // STEP 1: REQUEST OTP — send code to email or phone
  // ========================================================
  @Public()
  @Post('signup/request-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send OTP to email or phone for signup/login' })
  async requestOtp(@Body() dto: RequestSignupOtpDto) {
    return success(
      await this.authService.requestSignupOtp(dto),
      'Verification code sent',
    );
  }

  // ========================================================
  // STEP 2: VERIFY OTP + signup (new) or login (existing)
  // ========================================================
  @Public()
  @Post('signup/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP — creates account or logs in' })
  async verifyOtp(@Body() dto: VerifySignupOtpDto) {
    return success(
      await this.authService.verifySignupOtp(dto),
    );
  }

  // ========================================================
  // SOCIAL LOGIN — Google / Apple
  // ========================================================
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

  // ========================================================
  // PASSWORD LOGIN — for returning email+password users
  // ========================================================
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(@Body() dto: LoginDto) {
    return success(
      await this.authService.passwordLogin(dto.email, dto.password),
    );
  }

  // ========================================================
  // SET PASSWORD — for OTP users who want password later
  // ========================================================
  @ApiBearerAuth()
  @Post('password/set')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a password (for users who signed up via OTP)' })
  async setPassword(
    @CurrentUser('sub') userId: string,
    @Body() dto: SetPasswordDto,
  ) {
    return success(await this.authService.setPassword(userId, dto.password));
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

  // ========================================================
  // PROFILE
  // ========================================================
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

  // ========================================================
  // RESEND OTP
  // ========================================================
  @Public()
  @Post('signup/resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend verification code' })
  async resendOtp(@Body() dto: RequestSignupOtpDto) {
    return success(
      await this.authService.resendOtp(dto.email || dto.phone!),
      'Code resent',
    );
  }

  // ========================================================
  // TOKEN REFRESH
  // ========================================================
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    return success(await this.authService.refreshToken(dto.refreshToken));
  }
}
