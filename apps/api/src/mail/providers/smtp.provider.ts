import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { AppConfigService } from '../../config/app-config.service';
import { maskEmail, type MailProvider, type OutgoingMail } from '../mail.types';

/**
 * Nodemailer SMTP transport (Gmail app-password or any standard SMTP host).
 * Credentials come from .env only and are never logged.
 */
export class SmtpMailProvider implements MailProvider {
  private readonly logger = new Logger(SmtpMailProvider.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: AppConfigService) {}

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const { smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword } = this.config.mail;
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: { user: smtpUser, pass: smtpPassword },
      });
    }
    return this.transporter;
  }

  async send(mail: OutgoingMail): Promise<void> {
    const { fromName, fromEmail } = this.config.mail;
    await this.getTransporter().sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    this.logger.log(`Sent "${mail.subject}" to ${maskEmail(mail.to)}`);
  }
}
