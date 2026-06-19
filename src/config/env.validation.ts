import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsString, Max, Min, validateSync } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV!: Environment;

  @IsNumber()
  @Min(0)
  @Max(65535)
  PORT!: number;

  @IsString()
  API_PREFIX!: string;

  @IsString()
  DB_HOST!: string;
  @IsNumber()
  DB_PORT!: number;
  @IsString()
  DB_USERNAME!: string;
  @IsString()
  DB_PASSWORD!: string;
  @IsString()
  DB_DATABASE!: string;

  @IsString()
  REDIS_HOST!: string;
  @IsNumber()
  REDIS_PORT!: number;
  @IsString()
  REDIS_PASSWORD!: string;

  @IsString()
  JWT_SECRET!: string;
  @IsString()
  JWT_EXPIRY!: string;
  @IsString()
  JWT_REFRESH_EXPIRY!: string;

  @IsString()
  PAYSTACK_SECRET_KEY!: string;
  @IsString()
  NOMBA_SECRET_KEY!: string;

  @IsString()
  TERMII_API_KEY!: string;
  @IsString()
  SENDGRID_API_KEY!: string;

  @IsString()
  GOOGLE_MAPS_API_KEY!: string;
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validated;
}
