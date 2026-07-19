import { IsBoolean, IsEnum, IsOptional, IsString, Length, MinLength } from 'class-validator';
import { AuthProvider } from '@prisma/client';

export class OtpRequestDto {
  @IsString()
  @MinLength(8)
  phone!: string;

  @IsOptional()
  @IsString()
  shopId?: string;
}

export class OtpVerifyDto {
  @IsString()
  @MinLength(8)
  phone!: string;

  @IsString()
  @Length(4, 8)
  code!: string;

  @IsOptional()
  @IsString()
  shopId?: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(10)
  refreshToken!: string;
}

export class FirebaseLoginDto {
  /** Firebase ID token from the app's phone-auth flow. */
  @IsString()
  @MinLength(10)
  idToken!: string;

  @IsOptional()
  @IsString()
  shopId?: string;
}

export class LinkFirebaseDto {
  /** Firebase ID token for the provider being linked to the current account. */
  @IsString()
  @MinLength(10)
  idToken!: string;

  /** Set true to actually perform the merge after the user confirms. */
  @IsOptional()
  @IsBoolean()
  confirmMerge?: boolean;
}

export class UnlinkDto {
  @IsEnum(AuthProvider)
  provider!: AuthProvider;
}

export class SwitchTenantDto {
  /** The tenant ID to switch the active context to. */
  @IsString()
  @MinLength(1)
  tenantId!: string;
}
