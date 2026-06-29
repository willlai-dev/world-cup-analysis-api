import { ApiPropertyOptional } from '@nestjs/swagger';
import { MatchStage, MatchStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListMatchesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MatchStatus })
  @IsOptional()
  @IsEnum(MatchStatus)
  status?: MatchStatus;

  @ApiPropertyOptional({ enum: MatchStage })
  @IsOptional()
  @IsEnum(MatchStage)
  stage?: MatchStage;

  @ApiPropertyOptional({ description: 'ISO date (inclusive lower bound on kickoffAt)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date (inclusive upper bound on kickoffAt)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teamId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  groupName?: string;
}
