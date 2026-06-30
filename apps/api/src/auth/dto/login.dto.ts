import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class LoginDto {
  // Login identifier — email, including the seeded initial admin account.
  @ApiProperty({ example: "user@example.com", description: "Email" })
  @IsString()
  @MinLength(1)
  email!: string;

  @ApiProperty({ example: "password123" })
  @IsString()
  @MinLength(1)
  password!: string;
}
