import fs from 'fs';
import path from 'path';
import {
  AccountActivatedEmailPayload,
  AccountInvitationEmailPayload,
  CustomerAccountSetupEmailPayload,
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

const templateDirs = [
  path.join(__dirname, 'templates'),
  path.join(process.cwd(), 'src', 'emails', 'templates'),
];

function readTemplateFile(fileName: string) {
  for (const dir of templateDirs) {
    const file = path.join(dir, fileName);
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  }
  throw new Error(`Email template not found: ${fileName}`);
}

const emailStyles = readTemplateFile('base.css');

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(value = 0) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function renderTemplate(fileName: string, values: Record<string, unknown>) {
  const html = readTemplateFile(fileName);
  return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    if (key === 'emailStyles') return emailStyles;
    return escapeHtml(values[key]);
  });
}

function baseValues(values: Record<string, unknown> = {}) {
  return {
    appName: process.env.APP_NAME || 'Hook',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
    supportEmail: process.env.SUPPORT_EMAIL || process.env.BREVO_FROM_EMAIL || 'support@hook.africa',
    year: new Date().getFullYear(),
    ...values,
  };
}

export function otpEmailTemplate(payload: OtpEmailPayload) {
  const expires = payload.expiresInMinutes || Number(process.env.OTP_EXPIRY_MINUTES || 10);
  return {
    subject: 'Your Hook verification code',
    html: renderTemplate('otp.html', baseValues({
      name: payload.name || 'there',
      code: payload.code,
      title: 'Your one time password (OTP) is',
      intro: 'Use this code to verify your email address and continue with Hook.',
      expiresIn: `${expires} minutes`,
    })),
    text: `Your Hook verification code is ${payload.code}. It expires in ${expires} minutes.`,
  };
}

export function passwordResetEmailTemplate(payload: OtpEmailPayload) {
  const expires = payload.expiresInMinutes || Number(process.env.OTP_EXPIRY_MINUTES || 10);
  return {
    subject: 'Reset your Hook password',
    html: renderTemplate('password-reset.html', baseValues({
      name: payload.name || 'there',
      code: payload.code,
      expiresIn: `${expires} minutes`,
    })),
    text: `Use ${payload.code} to reset your Hook password. It expires in ${expires} minutes.`,
  };
}

export function welcomeEmailTemplate(payload: WelcomeEmailPayload) {
  return {
    subject: 'Welcome to Hook',
    html: renderTemplate('welcome.html', baseValues({ name: payload.name || 'there' })),
    text: `Welcome to Hook${payload.name ? `, ${payload.name}` : ''}.`,
  };
}

export function accountInvitationEmailTemplate(payload: AccountInvitationEmailPayload) {
  return {
    subject: 'Activate your Hook account',
    html: renderTemplate('account-invitation.html', baseValues({
      name: payload.name || 'there',
      accountType: payload.accountType,
      activationUrl: payload.activationUrl,
      expiresIn: `${payload.expiresInHours} hours`,
    })),
    text: `Activate your Hook ${payload.accountType} account: ${payload.activationUrl}. This link expires in ${payload.expiresInHours} hours.`,
  };
}

export function customerAccountSetupEmailTemplate(payload: CustomerAccountSetupEmailPayload) {
  return {
    subject: 'Set your Hook password',
    html: renderTemplate('customer-account-setup.html', baseValues({
      name: payload.name || 'there',
      email: payload.email,
      partnerName: payload.partnerName,
      activationUrl: payload.activationUrl,
      expiresIn: `${payload.expiresInHours} hours`,
    })),
    text: `${payload.partnerName} started an order for you on Hook. Set your password: ${payload.activationUrl}. This link expires in ${payload.expiresInHours} hours.`,
  };
}

export function orderConfirmationEmailTemplate(payload: OrderEmailPayload) {
  return {
    subject: `Hook order received: ${payload.orderCode}`,
    html: renderTemplate('order-confirmation.html', baseValues({
      name: payload.name || 'there',
      orderCode: payload.orderCode,
      amount: money(payload.amount),
      itemCount: payload.itemCount || 0,
    })),
    text: `Your Hook order ${payload.orderCode} has been received. Total: ${money(payload.amount)}.`,
  };
}

export function vendorNewOrderEmailTemplate(payload: OrderEmailPayload) {
  return {
    subject: `New Hook order for ${payload.vendorName || 'your store'}`,
    html: renderTemplate('vendor-new-order.html', baseValues({
      name: payload.name || payload.vendorName || 'there',
      vendorName: payload.vendorName || 'your store',
      customerName: payload.customerName || 'Customer',
      orderCode: payload.orderCode,
      amount: money(payload.amount),
      itemCount: payload.itemCount || 0,
      dashboardUrl: payload.dashboardUrl || `${process.env.APP_URL || 'http://localhost:3000'}/dashboard/orders`,
    })),
    text: `New Hook order ${payload.orderCode} for ${money(payload.amount)}.`,
  };
}

export function hookNewOrderEmailTemplate(payload: OrderEmailPayload) {
  return {
    subject: `New marketplace order: ${payload.orderCode}`,
    html: renderTemplate('hook-new-order.html', baseValues({
      name: payload.name || 'Hook Ops',
      customerName: payload.customerName || 'Customer',
      orderCode: payload.orderCode,
      amount: money(payload.amount),
      itemCount: payload.itemCount || 0,
      dashboardUrl: payload.dashboardUrl || `${process.env.APP_URL || 'http://localhost:3000'}/dashboard/orders`,
    })),
    text: `New marketplace order ${payload.orderCode} for ${money(payload.amount)}.`,
  };
}

export function orderStatusUpdateEmailTemplate(payload: OrderEmailPayload) {
  return {
    subject: `Hook order update: ${payload.orderCode}`,
    html: renderTemplate('order-status-update.html', baseValues({
      name: payload.name || 'there',
      orderCode: payload.orderCode,
      status: payload.status || 'updated',
      amount: money(payload.amount),
    })),
    text: `Your Hook order ${payload.orderCode} is now ${payload.status || 'updated'}.`,
  };
}

export function vendorApprovedEmailTemplate(payload: VendorDecisionEmailPayload) {
  return {
    subject: 'Your Hook vendor profile is approved',
    html: renderTemplate('vendor-approved.html', baseValues({ vendorName: payload.vendorName })),
    text: `${payload.vendorName} has been approved on Hook.`,
  };
}

export function vendorRejectedEmailTemplate(payload: VendorDecisionEmailPayload) {
  return {
    subject: 'Hook vendor profile update',
    html: renderTemplate('vendor-rejected.html', baseValues({
      vendorName: payload.vendorName,
      reason: payload.reason || 'Please review your vendor details and try again.',
    })),
    text: `${payload.vendorName} was not approved. ${payload.reason || ''}`,
  };
}

export function settlementUpdateEmailTemplate(payload: OrderEmailPayload) {
  return {
    subject: `Hook settlement update: ${payload.orderCode}`,
    html: renderTemplate('settlement-update.html', baseValues({
      name: payload.name || payload.vendorName || 'there',
      orderCode: payload.orderCode,
      amount: money(payload.amount),
      status: payload.status || 'pending',
    })),
    text: `Settlement for ${payload.orderCode}: ${money(payload.amount)} is ${payload.status || 'pending'}.`,
  };
}

export function orderCancelledEmailTemplate(payload: OrderCancelledEmailPayload) {
  return {
    subject: `Hook order cancelled: ${payload.orderCode}`,
    html: renderTemplate('order-cancelled.html', baseValues({
      name: payload.name || 'there',
      orderCode: payload.orderCode,
      amount: money(payload.amount),
      reasonSuffix: payload.reason ? ` (${payload.reason})` : '',
    })),
    text: `Your Hook order ${payload.orderCode} was cancelled${payload.reason ? ` (${payload.reason})` : ''}.`,
  };
}

export function paymentConfirmedEmailTemplate(payload: PaymentConfirmedEmailPayload) {
  return {
    subject: `Hook payment confirmed: ${payload.orderCode}`,
    html: renderTemplate('payment-confirmed.html', baseValues({
      name: payload.name || 'there',
      orderCode: payload.orderCode,
      amount: money(payload.amount),
    })),
    text: `Payment confirmed for Hook order ${payload.orderCode}: ${money(payload.amount)}.`,
  };
}

export function refundIssuedEmailTemplate(payload: RefundEmailPayload) {
  return {
    subject: `Hook refund issued: ${payload.orderCode}`,
    html: renderTemplate('refund-issued.html', baseValues({
      name: payload.name || 'there',
      orderCode: payload.orderCode,
      amount: money(payload.amountMinor / 100),
      refundTitle: payload.fullyRefunded ? 'Your refund is on the way' : 'A partial refund is on the way',
    })),
    text: `A refund for Hook order ${payload.orderCode} has been issued: ${money(payload.amountMinor / 100)}.`,
  };
}

export function negotiationOfferEmailTemplate(payload: NegotiationOfferEmailPayload) {
  return {
    subject: `New counter-offer for ${payload.productTitle}`,
    html: renderTemplate('negotiation-offer.html', baseValues({
      name: payload.name || 'there',
      productTitle: payload.productTitle,
      counterPrice: money(payload.counterPriceMinor / 100),
      expiresAt: new Date(payload.expiresAt).toLocaleString('en-NG'),
    })),
    text: `Hook sent a counter-offer of ${money(payload.counterPriceMinor / 100)} for ${payload.productTitle}.`,
  };
}

export function negotiationAcceptedEmailTemplate(payload: NegotiationAcceptedEmailPayload) {
  return {
    subject: `Price locked for ${payload.productTitle}`,
    html: renderTemplate('negotiation-accepted.html', baseValues({
      name: payload.name || 'there',
      productTitle: payload.productTitle,
      agreedPrice: money(payload.agreedPriceMinor / 100),
      quoteExpiresAt: new Date(payload.quoteExpiresAt).toLocaleString('en-NG'),
    })),
    text: `Your negotiated price of ${money(payload.agreedPriceMinor / 100)} for ${payload.productTitle} is locked in.`,
  };
}

const submissionDecisionCopy: Record<SubmissionDecisionEmailPayload['decision'], { title: string; lead: string; label: string; icon: string }> = {
  approved: { title: 'Your submission was approved', lead: 'was approved and is now live on Hook.', label: 'Approved', icon: '✓' },
  rejected: { title: 'Your submission was not approved', lead: 'was not approved.', label: 'Rejected', icon: '✕' },
  changes_requested: { title: 'Changes requested on your submission', lead: 'needs a few changes before it can go live.', label: 'Changes requested', icon: '!' },
};

export function submissionDecisionEmailTemplate(payload: SubmissionDecisionEmailPayload) {
  const copy = submissionDecisionCopy[payload.decision];
  return {
    subject: `Hook submission update: ${payload.productTitle}`,
    html: renderTemplate('submission-decision.html', baseValues({
      name: payload.name || 'there',
      productTitle: payload.productTitle,
      decisionTitle: copy.title,
      decisionLead: copy.lead,
      decisionLabel: copy.label,
      decisionIcon: copy.icon,
      reason: payload.reason || 'No additional notes were provided.',
    })),
    text: `Your Hook submission for ${payload.productTitle} ${copy.lead}${payload.reason ? ` ${payload.reason}` : ''}`,
  };
}

export function accountActivatedEmailTemplate(payload: AccountActivatedEmailPayload) {
  return {
    subject: "You're all set on Hook",
    html: renderTemplate('account-activated.html', baseValues({
      name: payload.name || 'there',
      accountType: payload.accountType,
    })),
    text: `Your Hook ${payload.accountType} account is now active.`,
  };
}
