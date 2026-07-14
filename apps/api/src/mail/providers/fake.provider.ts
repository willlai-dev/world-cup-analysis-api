import { Logger } from '@nestjs/common';
import { maskEmail, type MailProvider, type OutgoingMail } from '../mail.types';

const MAX_STORED_MAILS = 500;

/**
 * In-memory provider for NODE_ENV=test — never touches the network. Tests
 * read `sent` (or the helpers below) to assert on deliveries and to extract
 * verification/reset tokens from the rendered links.
 */
export class FakeMailProvider implements MailProvider {
  private readonly logger = new Logger(FakeMailProvider.name);
  readonly sent: OutgoingMail[] = [];

  send(mail: OutgoingMail): Promise<void> {
    this.sent.push(mail);
    if (this.sent.length > MAX_STORED_MAILS) {
      this.sent.shift();
    }
    // Subject + masked recipient only — never the body (it contains the token link).
    this.logger.debug(`Captured "${mail.subject}" for ${maskEmail(mail.to)}`);
    return Promise.resolve();
  }

  mailsTo(email: string): OutgoingMail[] {
    return this.sent.filter((m) => m.to === email);
  }

  lastMailTo(email: string): OutgoingMail | undefined {
    return this.mailsTo(email).at(-1);
  }

  /** Extracts the `token` query value from the last mail sent to `email`. */
  extractLastToken(email: string): string | undefined {
    const mail = this.lastMailTo(email);
    const match = mail?.text.match(/[?&]token=([A-Za-z0-9_-]+)/);
    return match?.[1];
  }

  clear(): void {
    this.sent.length = 0;
  }
}
