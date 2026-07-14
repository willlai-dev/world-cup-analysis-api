import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { MailService } from './mail.service';
import { MAIL_PROVIDER, type MailProvider } from './mail.types';
import { FakeMailProvider } from './providers/fake.provider';
import { SmtpMailProvider } from './providers/smtp.provider';

/**
 * Mail infrastructure. The active provider is picked from MAIL_PROVIDER
 * ("smtp"/"gmail" → SMTP, "fake" → in-memory); NODE_ENV=test always forces
 * the fake provider (enforced inside AppConfigService.mail).
 */
@Global()
@Module({
  providers: [
    {
      provide: MAIL_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): MailProvider =>
        config.mail.provider === 'fake' ? new FakeMailProvider() : new SmtpMailProvider(config),
    },
    MailService,
  ],
  exports: [MailService, MAIL_PROVIDER],
})
export class MailModule {}
