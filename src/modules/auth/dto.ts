import { IsOptional, IsString, Length, MinLength } from 'class-validator';

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
