import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { UserDto } from '../common/dto/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateMeDto } from './dto/update-me.dto';

export type MeDto = UserDto & {
  profile: { nickname: string | null; avatarUrl: string | null; bio: string | null } | null;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
    }
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerifiedAt != null,
      profile: user.profile
        ? { nickname: user.profile.nickname, avatarUrl: user.profile.avatarUrl, bio: user.profile.bio }
        : null,
    };
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<MeDto> {
    const profileData: Prisma.UserProfileUncheckedCreateInput = {
      userId,
      nickname: dto.nickname,
      avatarUrl: dto.avatarUrl,
      bio: dto.bio,
    };

    await this.prisma.$transaction(async (tx) => {
      if (dto.displayName !== undefined) {
        await tx.user.update({ where: { id: userId }, data: { displayName: dto.displayName } });
      }
      if (dto.nickname !== undefined || dto.avatarUrl !== undefined || dto.bio !== undefined) {
        await tx.userProfile.upsert({
          where: { userId },
          create: profileData,
          update: { nickname: dto.nickname, avatarUrl: dto.avatarUrl, bio: dto.bio },
        });
      }
    });

    return this.getMe(userId);
  }
}
