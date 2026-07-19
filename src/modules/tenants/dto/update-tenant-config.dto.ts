import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class WorkingHourEntryDto {
  @IsString()
  open!: string;

  @IsString()
  close!: string;

  @IsInt()
  @Min(0)
  capacity!: number;

  @IsBoolean()
  closed!: boolean;
}

export class UpdateWorkingHoursDto {
  @IsOptional() @ValidateNested() @Type(() => WorkingHourEntryDto) mon?: WorkingHourEntryDto;
  @IsOptional() @ValidateNested() @Type(() => WorkingHourEntryDto) tue?: WorkingHourEntryDto;
  @IsOptional() @ValidateNested() @Type(() => WorkingHourEntryDto) wed?: WorkingHourEntryDto;
  @IsOptional() @ValidateNested() @Type(() => WorkingHourEntryDto) thu?: WorkingHourEntryDto;
  @IsOptional() @ValidateNested() @Type(() => WorkingHourEntryDto) fri?: WorkingHourEntryDto;
  @IsOptional() @ValidateNested() @Type(() => WorkingHourEntryDto) sat?: WorkingHourEntryDto;
  @IsOptional() @ValidateNested() @Type(() => WorkingHourEntryDto) sun?: WorkingHourEntryDto;
}

export class UpdateTenantConfigDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  tagline?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  gstin?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  gstRate?: number;

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

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateWorkingHoursDto)
  workingHours?: UpdateWorkingHoursDto;
}
