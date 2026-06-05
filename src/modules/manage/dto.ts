import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AssignStaffDto {
  @IsOptional()
  @IsString()
  bookingId?: string;

  // `undefined` = leave unchanged, `null` = unassign, string = assign.
  @IsOptional()
  @IsString()
  pickupMembershipId?: string | null;

  @IsOptional()
  @IsString()
  serviceMembershipId?: string | null;
}

export class CreateServiceDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(0)
  pricePaise!: number;

  @IsInt()
  @Min(1)
  durationMin!: number;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  icon?: string;
}

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  pricePaise?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMin?: number;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class DayHoursDto {
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

export class SetWorkingHoursDto {
  @ValidateNested() @Type(() => DayHoursDto) mon!: DayHoursDto;
  @ValidateNested() @Type(() => DayHoursDto) tue!: DayHoursDto;
  @ValidateNested() @Type(() => DayHoursDto) wed!: DayHoursDto;
  @ValidateNested() @Type(() => DayHoursDto) thu!: DayHoursDto;
  @ValidateNested() @Type(() => DayHoursDto) fri!: DayHoursDto;
  @ValidateNested() @Type(() => DayHoursDto) sat!: DayHoursDto;
  @ValidateNested() @Type(() => DayHoursDto) sun!: DayHoursDto;
}
