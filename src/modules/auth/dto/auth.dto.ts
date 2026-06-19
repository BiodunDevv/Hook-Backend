import {
  IsEmail, IsString, MinLength, MaxLength, IsOptional,
  Matches, IsIn, IsNotEmpty,
} from 'class-validator';

// ============================================================
// REQUEST OTP — email or phone for signup/login
// ============================================================
export class RequestSignupOtpDto {
  @IsOptional()
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  phone?: string;
}

// ============================================================
// VERIFY OTP + auto-create account or login
// ============================================================
export class VerifySignupOtpDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(4)
  @MaxLength(6)
  @IsNotEmpty()
  otp!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;
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
// PASSWORD MANAGEMENT
// ============================================================
export class SetPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain uppercase, lowercase, and a number',
  })
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
