import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { ChatTurn } from './contracts';

export class ChatTurnDto implements ChatTurn {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @ApiProperty({ example: 'Mbappé 目前狀態如何？' })
  @IsString()
  @MaxLength(2000)
  content!: string;
}

export class ChatQuestionDto {
  @ApiProperty({ example: '目前冠軍預測前三名是誰？' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  question!: string;

  /**
   * Recent conversation turns, oldest→newest. The backend uses only the last 3
   * Q&A pairs; anything beyond that is trimmed server-side. Bounded here purely
   * as an abuse guard (per-turn length + total count).
   */
  @ApiPropertyOptional({ type: [ChatTurnDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ChatTurnDto)
  history?: ChatTurnDto[];
}
