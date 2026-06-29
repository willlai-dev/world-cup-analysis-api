import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NonAdminUserGuard } from '../common/guards/non-admin-user.guard';
import type { PlayerSummary, TeamSummary } from '../common/dto/contracts';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { FavoritesService } from '../favorites/favorites.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { type MeDto, UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
@UseGuards(NonAdminUserGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly favorites: FavoritesService,
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<MeDto> {
    return this.users.getMe(user.id);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto): Promise<MeDto> {
    return this.users.updateMe(user.id, dto);
  }

  @Get('me/favorites')
  getFavorites(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ teams: TeamSummary[]; players: PlayerSummary[] }> {
    return this.favorites.listFavorites(user.id);
  }
}
