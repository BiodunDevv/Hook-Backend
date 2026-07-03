export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface OtpEmailPayload {
  email: string;
  code: string;
}
