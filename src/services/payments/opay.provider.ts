import { createHmac, timingSafeEqual } from 'crypto';
import { HttpError } from '@utils/http';

type CashierInput = { reference: string; amount: number; callbackUrl: string; paymentMethod: string; customerEmail?: string };

export class OpayProvider {
  private readonly testBase = 'https://testapi.opaycheckout.com/api/v1/international';
  private readonly liveBase = 'https://api.opaycheckout.com/api/v1/international';

  get mode() { return process.env.OPAY_PAYIN_MODE === 'live' ? 'live' : 'test'; }
  get baseUrl() { return this.mode === 'live' ? this.liveBase : this.testBase; }
  get configured() {
    return Boolean(process.env.OPAY_PAYIN_PUBLIC_KEY && process.env.OPAY_PAYIN_SECRET_KEY && process.env.OPAY_PAYIN_MERCHANT_ID);
  }
  get capability() {
    return {
      provider: 'opay', mode: this.mode, payNow: this.configured,
      payOnDelivery: this.configured && process.env.OPAY_POD_ENABLED === 'true',
      reusableTokenization: this.configured && process.env.OPAY_TOKENIZATION_ENABLED === 'true',
    };
  }

  async initialize(input: CashierInput) {
    this.assertConfigured();
    const payload = {
      country: 'NG', reference: input.reference, amount: { total: Math.round(input.amount * 100), currency: 'NGN' },
      returnUrl: process.env.OPAY_PAYIN_RETURN_URL || 'hook://payments/return',
      callbackUrl: process.env.OPAY_PAYIN_CALLBACK_URL || input.callbackUrl,
      cancelUrl: process.env.OPAY_PAYIN_CANCEL_URL || 'hook://payments/cancel',
      expireAt: Date.now() + 15 * 60 * 1000,
      userInfo: input.customerEmail ? { userEmail: input.customerEmail } : undefined,
      product: { name: `Hook order ${input.reference}`, description: 'Hook marketplace order' },
    };
    const data = await this.request('/cashier/create', payload, 'public');
    const cashierUrl = String(data.cashierUrl || data.cashierURL || data.authorizationUrl || '');
    if (!cashierUrl) throw new HttpError(502, 'OPay did not return a checkout URL');
    return { providerMode: this.mode, reference: input.reference, cashierUrl, expiresAt: new Date(payload.expireAt).toISOString(), status: 'PENDING' };
  }

  async query(reference: string) {
    this.assertConfigured();
    return this.request('/cashier/status', { reference, country: 'NG' }, 'secret');
  }

  async refund(reference: string, amount: number) {
    this.assertConfigured();
    return this.request('/payment/refund/create', {
      reference: `RF-${reference}-${Date.now()}`, originalReference: reference,
      amount: { total: Math.round(amount * 100), currency: 'NGN' }, country: 'NG',
    }, 'secret');
  }

  verifyCallback(payload: Record<string, unknown>, signature: string) {
    this.assertConfigured();
    if (!signature) return false;
    const data = (payload.payload && typeof payload.payload === 'object' ? payload.payload : payload) as Record<string, any>;
    const canonical = `{Amount:"${String(data.amount ?? '')}",Currency:"${String(data.currency ?? '')}",Reference:"${String(data.reference ?? '')}",Refunded:${data.refunded ? 't' : 'f'},Status:"${String(data.status ?? '')}",Timestamp:"${String(data.timestamp ?? '')}",Token:"${String(data.token ?? '')}",TransactionID:"${String(data.transactionId ?? '')}"}`;
    const expected = createHmac('sha3-512', process.env.OPAY_PAYIN_SECRET_KEY!).update(canonical).digest('hex');
    const normalized = signature.trim().toLowerCase();
    return normalized.length === expected.length && timingSafeEqual(Buffer.from(normalized), Buffer.from(expected));
  }

  private async request(path: string, payload: Record<string, unknown>, auth: 'public' | 'secret') {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'content-type': 'application/json', MerchantId: process.env.OPAY_PAYIN_MERCHANT_ID!,
      Authorization: auth === 'public'
        ? `Bearer ${process.env.OPAY_PAYIN_PUBLIC_KEY}`
        : `Bearer ${createHmac('sha512', process.env.OPAY_PAYIN_SECRET_KEY!).update(body).digest('hex')}`,
    };
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new HttpError(502, 'OPay is temporarily unavailable');
    }
    const envelope = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok || !['00000', 'SUCCESS', '0'].includes(String(envelope.code || envelope.status || ''))) {
      throw new HttpError(502, String(envelope.message || 'OPay request failed'));
    }
    return (envelope.data || envelope) as Record<string, unknown>;
  }

  private assertConfigured() {
    if (!this.configured) throw new HttpError(503, 'OPay Pay Now is unavailable until merchant credentials are configured');
  }
}
