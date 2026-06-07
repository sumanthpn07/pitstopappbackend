import { IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
