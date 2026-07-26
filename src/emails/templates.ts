import fs from 'fs';
import path from 'path';
import {
  AccountInvitationEmailPayload,
  OrderEmailPayload,
  OtpEmailPayload,
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
