import { EmailSettings } from '@models/platform/email-settings.model';
import { emailSettingsCache } from '@lib/ttl-cache';

export type ResolvedEmailSettings = {
  supportEmail: string;
  hookOpsEmail: string;
  brevoFromEmail?: string;
  brevoFromName: string;
  appName: string;
  appUrl: string;
};

const CACHE_KEY = 'email-settings';

/**
 * Admin-editable email settings, DB-backed with env vars as the fallback for
 * any field left unset — so nothing breaks for deployments that never touch
 * the admin Email Configuration page.
 */
export async function getEmailSettings(): Promise<ResolvedEmailSettings> {
  const cached = emailSettingsCache.get(CACHE_KEY);
  if (cached) return cached;

  const doc = await EmailSettings.findOne({ key: 'email' }).lean();
  const resolved: ResolvedEmailSettings = {
    supportEmail: doc?.supportEmail || process.env.SUPPORT_EMAIL || process.env.BREVO_FROM_EMAIL || 'support@hook.africa',
    hookOpsEmail: doc?.hookOpsEmail || process.env.HOOK_OPS_EMAIL || process.env.BREVO_FROM_EMAIL || 'ops@hook.africa',
    brevoFromEmail: doc?.brevoFromEmail || process.env.BREVO_FROM_EMAIL,
    brevoFromName: doc?.brevoFromName || process.env.BREVO_FROM_NAME || 'Hook',
    appName: doc?.appName || process.env.APP_NAME || 'Hook',
    appUrl: doc?.appUrl || process.env.APP_URL || 'http://localhost:3000',
  };
  emailSettingsCache.set(CACHE_KEY, resolved);
  return resolved;
}

export function clearEmailSettingsCache() {
  emailSettingsCache.clear();
}
