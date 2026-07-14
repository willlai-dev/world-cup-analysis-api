/** A fully-rendered outgoing mail. Every mail ships both HTML and plain text. */
export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Mail transport abstraction. Swap implementations (SMTP today, an API-based
 * provider tomorrow) without touching MailService or any business logic.
 */
export interface MailProvider {
  send(mail: OutgoingMail): Promise<void>;
}

/** DI token for the active MailProvider implementation. */
export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');

/** "hongde1590@gmail.com" -> "h***@gmail.com" — safe for logs and UI hints. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) {
    return '***';
  }
  return `${email[0]}***${email.slice(at)}`;
}
