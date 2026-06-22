import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type EmailTemplate = 'welcome' | 'otp' | 'order_confirmed' | 'order_shipped' | 'order_delivered' | 'password_reset';

@Injectable()
export class BrevoService {
  private readonly logger = new Logger(BrevoService.name);
  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly fromName: string;
  private readonly baseUrl = 'https://api.brevo.com/v3/smtp/email';

  constructor(private configService: ConfigService) {
    this.apiKey = configService.get<string>('BREVO_API_KEY') || '';
    this.fromEmail = configService.get<string>('BREVO_FROM_EMAIL') || 'louisdiaz43@gmail.com';
    this.fromName = configService.get<string>('BREVO_FROM_NAME') || 'Hook';
  }

  async sendEmail(options: { to: string; subject: string; html: string }) {
    if (!this.apiKey) {
      this.logger.warn('Brevo API key not configured. Email not sent.');
      return { success: false, error: 'API key not configured' };
    }

    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: this.fromName, email: this.fromEmail },
          to: [{ email: options.to }],
          subject: options.subject,
          htmlContent: options.html,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.error(`Brevo error: ${res.status} ${body}`);
        return { success: false, error: body };
      }

      const data = await res.json();
      this.logger.log(`Email sent to ${options.to}: ${data.messageId}`);
      return { success: true, messageId: data.messageId };
    } catch (err: any) {
      this.logger.error(`Brevo send error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async sendTemplate(template: EmailTemplate, to: string, data: Record<string, string>) {
    const { subject, html } = this.buildTemplate(template, data);
    return this.sendEmail({ to, subject, html });
  }

  async sendOtp(email: string, code: string) {
    return this.sendTemplate('otp', email, { code });
  }

  private buildTemplate(template: EmailTemplate, data: Record<string, string>) {
    const templates: Record<EmailTemplate, { subject: string; html: string }> = {
      welcome: {
        subject: 'Welcome to Hook! 🎉',
        html: `<h1>Welcome ${data.name || 'Shopper'}!</h1><p>You're now part of the Hook community.</p>`,
      },
      otp: {
        subject: 'Your Hook Verification Code',
        html: `<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <div style="background: #FFC107; width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px; margin-bottom: 24px;">H</div>
          <h2 style="margin: 0 0 8px;">Verify your email</h2>
          <p style="color: #666; margin: 0 0 24px;">Use the code below to verify your email. Expires in 10 minutes.</p>
          <div style="background: #F5F5F5; border-radius: 8px; padding: 16px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; font-family: monospace;">${data.code}</div>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">If you didn't request this, ignore this email.</p>
        </div>`,
      },
      order_confirmed: {
        subject: `Order Confirmed: ${data.orderCode}`,
        html: `<h1>Order Confirmed 🛍️</h1><p>Your order <strong>${data.orderCode}</strong> has been placed.</p>`,
      },
      order_shipped: {
        subject: 'Your Hook Order is on the Way! 🚚',
        html: `<h1>Out for Delivery!</h1><p>Order <strong>${data.orderCode}</strong> is being delivered.</p>`,
      },
      order_delivered: {
        subject: 'Delivered! Enjoy Your Item 🎉',
        html: `<h1>Delivered!</h1><p>Your order <strong>${data.orderCode}</strong> has been delivered.</p>`,
      },
      password_reset: {
        subject: 'Reset Your Hook Password',
        html: `<p>Your password reset code is: <strong>${data.code}</strong></p>`,
      },
    };

    const tpl = templates[template] || templates.welcome;
    return {
      subject: tpl.subject,
      html: tpl.html.replace(/\$\{(\w+)\}/g, (_, key) => data[key] || ''),
    };
  }
}
