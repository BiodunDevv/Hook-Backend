import {
  IsEmail, IsString, MinLength, MaxLength, IsOptional,
  IsIn, IsNotEmpty,
} from 'class-validator';

// ============================================================
// REGISTER — email + password → sends OTP
// ============================================================
export class RegisterDto {
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;
}

// ============================================================
// VERIFY OTP — validates OTP
// ============================================================
export class VerifyOtpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(6)
  @IsNotEmpty()
  code!: string;
}

// ============================================================
// COMPLETE PROFILE — sets name and activates account
// ============================================================
export class CompleteProfileDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(50)
  firstName!: string;

  @IsString()
  @MaxLength(50)
  lastName!: string;
}

// ============================================================
// LOGIN — email + password
// ============================================================
export class LoginDto {
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password!: string;
}

// ============================================================
// SOCIAL LOGIN (Google / Apple)
// ============================================================
export class SocialLoginDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['google', 'apple'])
  provider!: 'google' | 'apple';

  @IsString()
  @IsNotEmpty()
  idToken!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;
}

// ============================================================
// PASSWORD MANAGEMENT
// ============================================================
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  newPassword!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class RequestOtpDto {
  @IsEmail()
  email!: string;
}

// ============================================================
// FORGOT PASSWORD
// ============================================================
export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email!: string;
}

export class VerifyResetOtpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(6)
  @IsNotEmpty()
  code!: string;
}

export class ResetPasswordDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  newPassword!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  confirmPassword!: string;
}
