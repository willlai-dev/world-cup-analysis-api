import { Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NonAdminUserGuard } from '../common/guards/non-admin-user.guard';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { FavoritesService } from './favorites.service';

@ApiTags('favorites')
@Controller('favorites')
@UseGuards(NonAdminUserGuard)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Post('teams/:teamId')
  addTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId') teamId: string,
  ): Promise<{ success: true }> {
    return this.favorites.addTeam(user.id, teamId);
  }

  @Delete('teams/:teamId')
  removeTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId') teamId: string,
  ): Promise<{ success: true }> {
    return this.favorites.removeTeam(user.id, teamId);
  }

  @Post('players/:playerId')
  addPlayer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('playerId') playerId: string,
  ): Promise<{ success: true }> {
    return this.favorites.addPlayer(user.id, playerId);
  }

  @Delete('players/:playerId')
  removePlayer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('playerId') playerId: string,
  ): Promise<{ success: true }> {
    return this.favorites.removePlayer(user.id, playerId);
  }
}
