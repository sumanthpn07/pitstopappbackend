import {
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PickupAddressDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  fullAddress!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  landmark?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @Type(() => Number)
  @IsNumber()
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @IsLongitude()
  lng!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateBookingDto {
  @IsString()
  @MinLength(1)
  serviceId!: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsString()
  @MinLength(1)
  scheduledAt!: string; // ISO 8601; validated/parsed in the service

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PickupAddressDto)
  pickupAddress?: PickupAddressDto;
}

export class CancelBookingDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
