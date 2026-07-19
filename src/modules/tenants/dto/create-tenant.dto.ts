import { IsOptional, IsString, MinLength, IsNumber, IsInt, Min, Max } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  tagline?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  gstin?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  slotDurationMin?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  slotCapacity?: number;
}
