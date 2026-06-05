import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  @MinLength(1)
  makeModel!: string;

  @IsOptional()
  @IsString()
  plate?: string;

  @IsOptional()
  @IsString()
  color?: string;
}
