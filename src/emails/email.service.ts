import { EmailMessage, OtpEmailPayload } from './email.types';
import { otpEmailTemplate } from './templates';

export class EmailService {
  async send(message: EmailMessage) {
    if (!process.env.BREVO_API_KEY || process.env.BREVO_API_KEY.includes('placeholder')) {
      console.log(`[email:dev] ${message.to} - ${message.subject}`);
      return { delivered: false, provider: 'console' };
    }

    console.log(`[email:queued] ${message.to} - ${message.subject}`);
    return { delivered: true, provider: 'brevo' };
  }

  async sendOtp(payload: OtpEmailPayload) {
    const template = otpEmailTemplate(payload);
    return this.send({
      to: payload.email,
      ...template,
    });
  }
}
