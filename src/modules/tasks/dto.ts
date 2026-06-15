import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ConditionKind } from '@prisma/client';

export class PhotoDto {
  @IsString()
  url!: string;

  @IsOptional()
  @IsString()
  caption?: string;
}

export class SubmitConditionReportDto {
  @IsOptional()
  @IsString()
  bookingId?: string;

  @IsEnum(ConditionKind)
  kind!: ConditionKind;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PhotoDto)
  photos!: PhotoDto[];
}

export class ToggleChecklistDto {
  @IsBoolean()
  done!: boolean;
}

export class PickupTripLocationDto {
  @Type(() => Number)
  @IsNumber()
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @IsLongitude()
  lng!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  speed?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(240)
  etaMin?: number;
}
