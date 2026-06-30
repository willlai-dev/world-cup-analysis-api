import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AppConfigService } from "../config/app-config.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { InitialAdminService } from "./initial-admin.service";
import { TokenService } from "./token.service";

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.jwtSecret,
        // ms-style duration string (e.g. "7d"); accepted at runtime by jsonwebtoken.
        signOptions: { expiresIn: config.jwtExpiresIn as `${number}d` },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    InitialAdminService,
    TokenService,
    // Global authentication guard (skips @Public routes), then role gate.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [JwtModule, TokenService],
})
export class AuthModule {}
