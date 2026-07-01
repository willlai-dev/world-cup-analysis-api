import { ApiPropertyOptional } from '@nestjs/swagger';
import { TeamRatingTier } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListTeamsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'Filter by knockout elimination status' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'boolean' ? value : value === 'true'))
  @IsBoolean()
  eliminated?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  continent?: string;

  @ApiPropertyOptional({ enum: TeamRatingTier })
  @IsOptional()
  @IsEnum(TeamRatingTier)
  ratingTier?: TeamRatingTier;

  @ApiPropertyOptional({
    description: 'championScore | formScore | worldRanking | nameEn | ratingTier',
  })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
