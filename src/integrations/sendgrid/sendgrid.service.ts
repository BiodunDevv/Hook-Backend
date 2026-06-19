import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type EmailTemplate = 'welcome' | 'otp' | 'order_confirmed' | 'order_shipped' | 'order_delivered' | 'password_reset';

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

@Injectable()
export class SendGridService {
  private readonly logger = new Logger(SendGridService.name);
  private readonly apiKey: string;
  private readonly fromEmail: string;

  constructor(private configService: ConfigService) {
    this.apiKey = configService.get<string>('SENDGRID_API_KEY') || '';
    this.fromEmail = configService.get<string>('SENDGRID_FROM_EMAIL') || 'noreply@hook.ng';
  }

  async sendEmail(options: SendEmailOptions) {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: options.to }] }],
          from: { email: options.from || this.fromEmail },
          subject: options.subject,
          content: [{ type: 'text/html', value: options.html }],
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.error(`SendGrid error: ${res.status} ${body}`);
      }
      return { success: res.ok };
    } catch (err: any) {
      this.logger.error(`SendGrid send error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async sendTemplate(template: EmailTemplate, to: string, data: Record<string, string>) {
    const { subject, html } = this.buildTemplate(template, data);
    return this.sendEmail({ to, subject, html });
  }

  private buildTemplate(template: EmailTemplate, data: Record<string, string>) {
    const templates: Record<EmailTemplate, { subject: string; html: string }> = {
      welcome: {
        subject: 'Welcome to Hook! 🎉',
        html: `<h1>Welcome ${data.name || 'Shopper'}!</h1><p>You're now part of the Hook community. Shop fashion, negotiate prices, and get delivery in 24 hours.</p>`,
      },
      otp: {
        subject: 'Your Hook Verification Code',
        html: `<p>Your verification code is: <strong>${data.code}</strong></p><p>Valid for 10 minutes.</p>`,
      },
      order_confirmed: {
        subject: `Order Confirmed: ${data.orderCode}`,
        html: `<h1>Order Confirmed 🛍️</h1><p>Your order <strong>${data.orderCode}</strong> has been placed. We'll notify you when it's on the way.</p>`,
      },
      order_shipped: {
        subject: `Your Hook Order is on the Way! 🚚`,
        html: `<h1>Out for Delivery!</h1><p>Order <strong>${data.orderCode}</strong> is being delivered by ${data.driverName || 'your Hook driver'}.</p>`,
      },
      order_delivered: {
        subject: `Delivered! Enjoy Your Item 🎉`,
        html: `<h1>Delivered!</h1><p>Your order <strong>${data.orderCode}</strong> has been delivered. Enjoy!</p>`,
      },
      password_reset: {
        subject: 'Reset Your Hook Password',
        html: `<p>Your password reset code is: <strong>${data.code}</strong></p><p>If you didn't request this, ignore this email.</p>`,
      },
    };

    const tpl = templates[template] || templates.welcome;
    return {
      subject: tpl.subject,
      html: tpl.html.replace(/\$\{(\w+)\}/g, (_, key) => data[key] || ''),
    };
  }
}
