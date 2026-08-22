import {
  AccountActivatedEmailPayload,
  AccountInvitationEmailPayload,
  CustomerAccountSetupEmailPayload,
  EmailMessage,
  NegotiationAcceptedEmailPayload,
  NegotiationOfferEmailPayload,
  OrderCancelledEmailPayload,
  OrderEmailPayload,
  OtpEmailPayload,
  PaymentConfirmedEmailPayload,
  RefundEmailPayload,
  SubmissionDecisionEmailPayload,
  VendorDecisionEmailPayload,
  WelcomeEmailPayload,
} from './email.types';
import {
  accountActivatedEmailTemplate,
  accountInvitationEmailTemplate,
  customerAccountSetupEmailTemplate,
  hookNewOrderEmailTemplate,
  negotiationAcceptedEmailTemplate,
  negotiationOfferEmailTemplate,
  orderCancelledEmailTemplate,
  orderConfirmationEmailTemplate,
  orderStatusUpdateEmailTemplate,
  otpEmailTemplate,
  passwordResetEmailTemplate,
  paymentConfirmedEmailTemplate,
  refundIssuedEmailTemplate,
  settlementUpdateEmailTemplate,
  submissionDecisionEmailTemplate,
  setResolvedEmailSettings,
  vendorApprovedEmailTemplate,
  vendorNewOrderEmailTemplate,
  vendorRejectedEmailTemplate,
  welcomeEmailTemplate,
} from './templates';
import { getEmailSettings } from '@services/email-settings.service';

type BrevoSendResponse = {
  messageId?: string;
};

function isBrevoConfigured() {
  const key = process.env.BREVO_API_KEY;
  return Boolean(key && !key.includes('placeholder'));
}

export class EmailService {
  /**
   * Pulls the admin-configurable settings (support email, app name/URL, etc.)
   * into templates.ts's module-level cache before any render*Template() call
   * runs, so baseValues() picks them up without needing to be async itself.
   */
  private async loadSettings() {
    const settings = await getEmailSettings();
    setResolvedEmailSettings(settings);
    return settings;
  }

  async send(message: EmailMessage) {
    if (!isBrevoConfigured()) {
      console.log(`[email:dev] ${message.to} - ${message.subject}`);
      return { delivered: false, provider: 'console' };
    }

    const settings = await getEmailSettings();
    const fromEmail = settings.brevoFromEmail;
    if (!fromEmail) {
      console.warn('[email:brevo] No sender email configured (BREVO_FROM_EMAIL or admin Email Configuration). Falling back to console provider.');
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
          name: settings.brevoFromName,
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
    await this.loadSettings();
    const template = payload.purpose === 'password_reset'
      ? passwordResetEmailTemplate(payload)
      : otpEmailTemplate(payload);
    return this.send({
      to: payload.email,
      ...template,
    });
  }

  async sendWelcome(payload: WelcomeEmailPayload) {
    await this.loadSettings();
    const template = welcomeEmailTemplate(payload);
    return this.send({ to: payload.email, ...template });
  }

  async sendAccountInvitation(payload: AccountInvitationEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.email, ...accountInvitationEmailTemplate(payload) });
  }

  async sendCustomerAccountSetup(payload: CustomerAccountSetupEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.email, ...customerAccountSetupEmailTemplate(payload) });
  }

  async sendOrderConfirmation(payload: OrderEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.to, ...orderConfirmationEmailTemplate(payload) });
  }

  async sendVendorNewOrder(payload: OrderEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.to, ...vendorNewOrderEmailTemplate(payload) });
  }

  async sendHookNewOrder(payload: OrderEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.to, ...hookNewOrderEmailTemplate(payload) });
  }

  async sendOrderStatusUpdate(payload: OrderEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.to, ...orderStatusUpdateEmailTemplate(payload) });
  }

  async sendVendorApproved(payload: VendorDecisionEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.to, ...vendorApprovedEmailTemplate(payload) });
  }

  async sendVendorRejected(payload: VendorDecisionEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.to, ...vendorRejectedEmailTemplate(payload) });
  }

  async sendSettlementUpdate(payload: OrderEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.to, ...settlementUpdateEmailTemplate(payload) });
  }

  async sendOrderCancelled(payload: OrderCancelledEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.to, ...orderCancelledEmailTemplate(payload) });
  }

  async sendPaymentConfirmed(payload: PaymentConfirmedEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.to, ...paymentConfirmedEmailTemplate(payload) });
  }

  async sendRefundIssued(payload: RefundEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.to, ...refundIssuedEmailTemplate(payload) });
  }

  async sendNegotiationOffer(payload: NegotiationOfferEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.to, ...negotiationOfferEmailTemplate(payload) });
  }

  async sendNegotiationAccepted(payload: NegotiationAcceptedEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.to, ...negotiationAcceptedEmailTemplate(payload) });
  }

  async sendSubmissionDecision(payload: SubmissionDecisionEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.to, ...submissionDecisionEmailTemplate(payload) });
  }

  async sendAccountActivated(payload: AccountActivatedEmailPayload) {
    await this.loadSettings();
    return this.send({ to: payload.email, ...accountActivatedEmailTemplate(payload) });
  }
}
