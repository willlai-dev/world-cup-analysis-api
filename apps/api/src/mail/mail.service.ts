import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { MAIL_PROVIDER, maskEmail, type MailProvider, type OutgoingMail } from './mail.types';

/**
 * Renders and dispatches all system mails (zh-TW copy, HTML + plain text).
 * Delivery is best-effort: failures are logged (masked recipient, no token,
 * no link, no credentials) and never break the calling API flow.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAIL_PROVIDER) private readonly provider: MailProvider,
    private readonly config: AppConfigService,
  ) {}

  async sendEmailVerification(to: string, token: string): Promise<void> {
    const link = `${this.config.frontendUrl}/verify-email?token=${token}`;
    const ttl = this.config.authTokens.verifyTtlMinutes;
    await this.dispatch('驗證信', {
      to,
      subject: '【AI 世界盃分析】請驗證你的 Email',
      text: [
        '感謝註冊 AI 世界盃分析!',
        '',
        `請在 ${ttl} 分鐘內開啟下列連結完成 Email 驗證(連結僅可使用一次):`,
        link,
        '',
        '如果這不是你本人的操作,請忽略此信件。',
      ].join('\n'),
      html: this.layout(
        '請驗證你的 Email',
        `<p>感謝註冊 AI 世界盃分析!</p>
         <p>請在 <strong>${ttl} 分鐘</strong>內點擊下方按鈕完成 Email 驗證(連結僅可使用一次):</p>
         ${this.button(link, '驗證 Email')}
         <p style="font-size:12px;color:#64748b">若按鈕無法點擊,請複製此連結到瀏覽器:<br>${link}</p>
         <p style="font-size:12px;color:#64748b">如果這不是你本人的操作,請忽略此信件。</p>`,
      ),
    });
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const link = `${this.config.frontendUrl}/reset-password?token=${token}`;
    const ttl = this.config.authTokens.resetTtlMinutes;
    await this.dispatch('密碼重設信', {
      to,
      subject: '【AI 世界盃分析】密碼重設申請',
      text: [
        '我們收到了你的密碼重設申請。',
        '',
        `請在 ${ttl} 分鐘內開啟下列連結設定新密碼(連結僅可使用一次):`,
        link,
        '',
        '如果這不是你本人的操作,請忽略此信件,你的密碼不會被變更。',
      ].join('\n'),
      html: this.layout(
        '密碼重設申請',
        `<p>我們收到了你的密碼重設申請。</p>
         <p>請在 <strong>${ttl} 分鐘</strong>內點擊下方按鈕設定新密碼(連結僅可使用一次):</p>
         ${this.button(link, '重設密碼')}
         <p style="font-size:12px;color:#64748b">若按鈕無法點擊,請複製此連結到瀏覽器:<br>${link}</p>
         <p style="font-size:12px;color:#64748b">如果這不是你本人的操作,請忽略此信件,你的密碼不會被變更。</p>`,
      ),
    });
  }

  async sendPasswordChangedNotice(to: string): Promise<void> {
    const link = `${this.config.frontendUrl}/forgot-password`;
    await this.dispatch('密碼變更通知信', {
      to,
      subject: '【AI 世界盃分析】你的密碼已變更',
      text: [
        '你的帳號密碼剛剛已成功變更,所有既有登入 session 已被登出。',
        '',
        '如果這不是你本人的操作,請立即透過「忘記密碼」重新設定密碼:',
        link,
      ].join('\n'),
      html: this.layout(
        '你的密碼已變更',
        `<p>你的帳號密碼剛剛已成功變更,所有既有登入 session 已被登出。</p>
         <p>如果這不是你本人的操作,請立即透過「忘記密碼」重新設定密碼:</p>
         ${this.button(link, '重新設定密碼')}`,
      ),
    });
  }

  private async dispatch(kind: string, mail: OutgoingMail): Promise<void> {
    try {
      await this.provider.send(mail);
    } catch (error) {
      // Never log the mail body/link — it contains the single-use token.
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${kind}寄送失敗(${maskEmail(mail.to)}): ${reason}`);
    }
  }

  private layout(title: string, body: string): string {
    return `<div style="font-family:'Segoe UI',system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
  <h2 style="color:#1d4ed8;margin:0 0 16px">${title}</h2>
  ${body}
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px">
  <p style="font-size:12px;color:#94a3b8">AI 世界盃分析 — 此為系統自動寄送信件,請勿直接回覆。</p>
</div>`;
  }

  private button(link: string, label: string): string {
    return `<p style="margin:20px 0"><a href="${link}" style="background:#1d4ed8;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">${label}</a></p>`;
  }
}
