import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
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
