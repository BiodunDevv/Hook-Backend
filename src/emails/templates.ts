import { OtpEmailPayload } from './email.types';

export function otpEmailTemplate({ code }: OtpEmailPayload) {
  return {
    subject: 'Your Hook verification code',
    html: `<p>Your Hook verification code is <strong>${code}</strong>.</p>`,
    text: `Your Hook verification code is ${code}.`,
  };
}

export function welcomeEmailTemplate(firstName: string) {
  return {
    subject: 'Welcome to Hook',
    html: `<p>Welcome to Hook${firstName ? `, ${firstName}` : ''}.</p>`,
    text: `Welcome to Hook${firstName ? `, ${firstName}` : ''}.`,
  };
}
