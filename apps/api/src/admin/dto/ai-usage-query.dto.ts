import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class AiUsageQueryDto {
  @ApiPropertyOptional({
    description: 'Window start (ISO 8601); default = 7 days before `to`',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Window end (ISO 8601); default = now' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    description: 'Filter by AI task type (e.g. GENERAL_CHAT, NEWS_TRANSLATION)',
  })
  @IsOptional()
  @IsString()
  taskType?: string;
}
