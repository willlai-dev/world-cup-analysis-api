import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChatQuestionDto {
  @ApiProperty({ example: '目前冠軍預測前三名是誰？' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  question!: string;
}
