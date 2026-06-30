import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { UserRole, UserStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../prisma/prisma.service";

const BCRYPT_ROUNDS = 10;
const SEED_ADMIN_ID = "seed-user-admin";

@Injectable()
export class InitialAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InitialAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { email, password, displayName } = this.config.seedAdmin;
    const existing =
      (await this.prisma.user.findUnique({ where: { id: SEED_ADMIN_ID } })) ??
      (await this.prisma.user.findUnique({ where: { email } }));

    if (!existing) {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await this.prisma.user.create({
        data: {
          id: SEED_ADMIN_ID,
          email,
          passwordHash,
          displayName,
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          profile: { create: { nickname: displayName } },
        },
      });
      this.logger.log(`Created initial admin account "${email}".`);
      return;
    }

    const shouldRefreshPassword = !(await bcrypt.compare(
      password,
      existing.passwordHash,
    ));
    const data: {
      email?: string;
      displayName?: string;
      role?: UserRole;
      status?: UserStatus;
      passwordHash?: string;
    } = {};

    if (existing.email !== email) {
      data.email = email;
    }
    if (existing.displayName !== displayName) {
      data.displayName = displayName;
    }
    if (existing.role !== UserRole.ADMIN) {
      data.role = UserRole.ADMIN;
    }
    if (existing.status !== UserStatus.ACTIVE) {
      data.status = UserStatus.ACTIVE;
    }
    if (shouldRefreshPassword) {
      data.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    }

    if (Object.keys(data).length === 0) {
      return;
    }

    await this.prisma.user.update({ where: { id: existing.id }, data });
    this.logger.log(`Refreshed initial admin account "${email}".`);
  }
}
