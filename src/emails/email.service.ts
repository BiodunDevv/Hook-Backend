import {
  AccountInvitationEmailPayload,
  EmailMessage,
  OrderEmailPayload,
  OtpEmailPayload,
  VendorDecisionEmailPayload,
  WelcomeEmailPayload,
} from './email.types';
import {
  accountInvitationEmailTemplate,
  hookNewOrderEmailTemplate,
  orderConfirmationEmailTemplate,
  orderStatusUpdateEmailTemplate,
  otpEmailTemplate,
  passwordResetEmailTemplate,
  settlementUpdateEmailTemplate,
  vendorApprovedEmailTemplate,
  vendorNewOrderEmailTemplate,
  vendorRejectedEmailTemplate,
  welcomeEmailTemplate,
} from './templates';

type BrevoSendResponse = {
  messageId?: string;
};

function isBrevoConfigured() {
  const key = process.env.BREVO_API_KEY;
  return Boolean(key && !key.includes('placeholder'));
}

export class EmailService {
  async send(message: EmailMessage) {
    if (!isBrevoConfigured()) {
      console.log(`[email:dev] ${message.to} - ${message.subject}`);
      return { delivered: false, provider: 'console' };
    }

    const fromEmail = process.env.BREVO_FROM_EMAIL;
    if (!fromEmail) {
      console.warn('[email:brevo] BREVO_FROM_EMAIL is missing. Falling back to console provider.');
      console.log(`[email:dev] ${message.to} - ${message.subject}`);
      return { delivered: false, provider: 'console' };
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': process.env.BREVO_API_KEY!,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: {
          email: fromEmail,
          name: process.env.BREVO_FROM_NAME || 'Hook',
        },
        to: [{ email: message.to }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
    });

    const data = await response.json().catch(() => ({} as BrevoSendResponse));
    if (!response.ok) {
      console.error(`[email:brevo] Failed to send to ${message.to}: ${response.status}`);
      throw new Error('Email provider failed to send message');
    }

    console.log(`[email:brevo] Sent to ${message.to} (${data.messageId || 'queued'})`);
    return { delivered: true, provider: 'brevo', messageId: data.messageId };
  }

  async sendOtp(payload: OtpEmailPayload) {
    const template = payload.purpose === 'password_reset'
      ? passwordResetEmailTemplate(payload)
      : otpEmailTemplate(payload);
    return this.send({
      to: payload.email,
      ...template,
    });
  }

  async sendWelcome(payload: WelcomeEmailPayload) {
    const template = welcomeEmailTemplate(payload);
    return this.send({ to: payload.email, ...template });
  }

  async sendAccountInvitation(payload: AccountInvitationEmailPayload) {
    return this.send({ to: payload.email, ...accountInvitationEmailTemplate(payload) });
  }

  async sendOrderConfirmation(payload: OrderEmailPayload) {
    return this.send({ to: payload.to, ...orderConfirmationEmailTemplate(payload) });
  }

  async sendVendorNewOrder(payload: OrderEmailPayload) {
    return this.send({ to: payload.to, ...vendorNewOrderEmailTemplate(payload) });
  }

  async sendHookNewOrder(payload: OrderEmailPayload) {
    return this.send({ to: payload.to, ...hookNewOrderEmailTemplate(payload) });
  }

  async sendOrderStatusUpdate(payload: OrderEmailPayload) {
    return this.send({ to: payload.to, ...orderStatusUpdateEmailTemplate(payload) });
  }

  async sendVendorApproved(payload: VendorDecisionEmailPayload) {
    return this.send({ to: payload.to, ...vendorApprovedEmailTemplate(payload) });
  }

  async sendVendorRejected(payload: VendorDecisionEmailPayload) {
    return this.send({ to: payload.to, ...vendorRejectedEmailTemplate(payload) });
  }

  async sendSettlementUpdate(payload: OrderEmailPayload) {
    return this.send({ to: payload.to, ...settlementUpdateEmailTemplate(payload) });
  }
}
