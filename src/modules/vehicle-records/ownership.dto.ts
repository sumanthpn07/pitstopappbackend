import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { TransferType } from '@prisma/client';

export class InitiateTransferDto {
  @IsString()
  newOwnerId!: string;

  @IsEnum(TransferType)
  transferType!: TransferType;

  @IsInt()
  @Min(0)
  odometerKm!: number;
}

export class RespondTransferDto {
  @IsEnum(['confirm', 'decline'] as const)
  action!: 'confirm' | 'decline';
}
