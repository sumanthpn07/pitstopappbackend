import { IsOptional, IsString, MinLength } from 'class-validator';

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
}

export class CancelBookingDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
