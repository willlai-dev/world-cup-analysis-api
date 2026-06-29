import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminOnlyGuard } from '../common/guards/admin-only.guard';
import { buildPaginationMeta, Paginated } from '../common/dto/api-response.types';
import type { UserDto } from '../common/dto/contracts';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AdminService } from './admin.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { RegisterAdminDto } from './dto/register-admin.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

@ApiTags('admin')
@Controller('admin')
@UseGuards(AdminOnlyGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  async listUsers(@Query() query: ListUsersQueryDto): Promise<Paginated<UserDto[]>> {
    const { items, total } = await this.admin.listUsers(query);
    return new Paginated(items, buildPaginationMeta(query.page, query.pageSize, total));
  }

  @Post('users')
  @HttpCode(201)
  createUser(@Body() dto: CreateUserDto): Promise<UserDto> {
    return this.admin.createUser(dto);
  }

  @Patch('users/:userId/role')
  updateRole(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserRoleDto,
  ): Promise<UserDto> {
    return this.admin.updateRole(userId, dto.role);
  }

  @Delete('users/:userId')
  softDelete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
  ): Promise<{ success: true; user: UserDto }> {
    return this.admin.softDeleteUser(actor.id, userId);
  }

  @Post('register-admin')
  @HttpCode(201)
  registerAdmin(@Body() dto: RegisterAdminDto): Promise<UserDto> {
    return this.admin.registerAdmin(dto);
  }
}
