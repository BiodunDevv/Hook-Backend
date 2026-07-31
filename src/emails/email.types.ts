export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface OtpEmailPayload {
  email: string;
  code: string;
  name?: string;
  purpose?: 'verification' | 'password_reset';
  expiresInMinutes?: number;
}

export interface WelcomeEmailPayload {
  email: string;
  name?: string;
}

export interface AccountInvitationEmailPayload {
  email: string;
  name: string;
  accountType: string;
  activationUrl: string;
  expiresInHours: number;
}

export interface OrderEmailPayload {
  to: string;
  name?: string;
  orderCode: string;
  amount: number;
  itemCount?: number;
  customerName?: string;
  vendorName?: string;
  status?: string;
  dashboardUrl?: string;
}

export interface VendorDecisionEmailPayload {
  to: string;
  vendorName: string;
  reason?: string;
}
