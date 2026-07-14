import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Raw verification token from the email link' })
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  token!: string;
}
