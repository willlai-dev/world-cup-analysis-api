import { ApiPropertyOptional } from '@nestjs/swagger';
import { PlayerPosition, RatingTier } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListPlayersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teamId?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: "Filter by the player's national team knockout elimination status",
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'boolean' ? value : value === 'true'))
  @IsBoolean()
  eliminated?: boolean;

  @ApiPropertyOptional({ enum: PlayerPosition })
  @IsOptional()
  @IsEnum(PlayerPosition)
  position?: PlayerPosition;

  @ApiPropertyOptional({ enum: RatingTier })
  @IsOptional()
  @IsEnum(RatingTier)
  ratingTier?: RatingTier;

  @ApiPropertyOptional({
    description:
      'overallScore | attackScore | creativityScore | techniqueScore | defenseScore | physicalScore | formScore | nameEn',
  })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
