import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  IsDateString,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ServiceCategory } from '@prisma/client';

class PartUsedDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateOwnerServiceEventDto {
  @IsString()
  @MaxLength(200)
  serviceType!: string;

  @IsEnum(ServiceCategory)
  category!: ServiceCategory;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsInt()
  @Min(0)
  @Max(999999999)
  totalCostPaise!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  odometerKm?: number;

  @IsDateString()
  completedAt!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartUsedDto)
  partsUsed?: PartUsedDto[];

  @IsString()
  @MaxLength(200)
  tenantName!: string;
}
