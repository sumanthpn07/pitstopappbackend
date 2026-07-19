import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { FuelType, TransmissionType } from '@prisma/client';

export class CreateVehicleRecordDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(17)
  vin?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(25)
  chassisNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  registrationPlate?: string;

  @IsString()
  @MinLength(1)
  make!: string;

  @IsString()
  @MinLength(1)
  model!: string;

  @IsInt()
  @Min(1886)
  @Max(2100)
  year!: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsEnum(FuelType)
  fuelType?: FuelType;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20000)
  engineCapacityCc?: number;

  @IsOptional()
  @IsEnum(TransmissionType)
  transmission?: TransmissionType;
}

export class UpdateVehicleRecordDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  make?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1886)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsEnum(FuelType)
  fuelType?: FuelType;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20000)
  engineCapacityCc?: number;

  @IsOptional()
  @IsEnum(TransmissionType)
  transmission?: TransmissionType;

  @IsOptional()
  @IsString()
  @MaxLength(17)
  vin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(25)
  chassisNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  registrationPlate?: string;
}
