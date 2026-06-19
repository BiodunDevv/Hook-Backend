import { IsString, IsOptional, IsEmail, IsIn } from 'class-validator';
import { UserRole } from '@common/constants';

export class CreateAdminUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsOptional()
  @IsString()
  @IsIn([UserRole.SHOPPER, UserRole.VENDOR, UserRole.FIELD_AGENT, UserRole.EV_DRIVER, UserRole.ADMIN])
  role?: UserRole;
}

export class UpdateUserRoleDto {
  @IsString()
  @IsIn([UserRole.SHOPPER, UserRole.VENDOR, UserRole.FIELD_AGENT, UserRole.EV_DRIVER, UserRole.ADMIN, UserRole.SUPER_ADMIN])
  role!: UserRole;
}
