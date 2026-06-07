import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
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

  @IsOptional()
  @IsString()
  category?: string;
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

export class CreateEmployeeDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(6)
  phone!: string;
}

export class CreateOfferDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  subtitle!: string;

  @IsString()
  @MinLength(1)
  badge!: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;
}

export class CreateExpenseDto {
  // Defaults to "expense"; pass "income" to record takings.
  @IsOptional()
  @IsIn(['income', 'expense'])
  type?: 'income' | 'expense';

  @IsString()
  @MinLength(1)
  category!: string;

  @IsInt()
  @Min(0)
  amountPaise!: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  date?: string;
}
