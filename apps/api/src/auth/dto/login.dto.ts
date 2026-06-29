import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  // Login identifier — an email for normal users, or a username for the
  // seeded initial admin (e.g. "abc123"). Looked up against the `email` column.
  @ApiProperty({ example: 'user@example.com', description: 'Email or admin username' })
  @IsString()
  @MinLength(1)
  email!: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(1)
  password!: string;
}
