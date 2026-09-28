import { createHmac } from 'crypto';
import { HttpError } from '@utils/http';
import type { LogisticsProvider, LogisticsProviderName } from './logistics-provider';

type FezAddress = {
  recipientName?: string;
  phone?: string;
  line1?: string;
  city?: string;
  state?: string;
};

/** Reads Hook's mixed addressSnapshot/legacy deliveryAddress shapes into the one Fez needs. */
function readAddress(input: Record<string, unknown>): FezAddress {
  const snapshot = (input.deliveryAddressSnapshot || {}) as Record<string, any>;
  return {
    recipientName: snapshot.recipientName || snapshot.name,
    phone: snapshot.phone,
    line1: snapshot.line1 || snapshot.street || snapshot.formattedAddress,
    city: snapshot.cityName || snapshot.city,
    state: snapshot.stateName || snapshot.state,
  };
}

/**
 * Fez Delivery adapter. Auth is just the account's secret-key (from
 * Developers > Manage API Key in the Fez business portal), sent as the
 * secret-key header on every call — no login step, no bearer token.
 */
export class FezLogisticsProvider implements LogisticsProvider {
  readonly name: LogisticsProviderName = 'fez';
  readonly enabled = true;
  private readonly baseUrl = process.env.FEZ_BASE_URL || 'https://apisandbox.fezdelivery.co/v1';

  private secretKey() {
    const value = process.env.FEZ_SECRET_KEY;
    if (!value) throw new HttpError(503, 'Fez logistics is not configured', undefined, 'LOGISTICS_PROVIDER_UNAVAILABLE');
    return value;
  }

  private async send(path: string, init: RequestInit): Promise<Record<string, any>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'secret-key': this.secretKey(), ...(init.headers as Record<string, string> | undefined) };
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(15000) });
    } catch {
      throw new HttpError(503, 'Fez is temporarily unavailable', undefined, 'LOGISTICS_PROVIDER_UNAVAILABLE');
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, any>;
    if (!response.ok || String(body.status || '').toLowerCase() !== 'success') {
      throw new HttpError(502, String(body.description || 'Fez could not process the request'), { httpStatus: response.status }, 'LOGISTICS_PROVIDER_ERROR');
    }
    return body;
  }

  async quote(input: Record<string, unknown>) {
    const address = readAddress(input);
    const state = String(input.stateName || address.state || '');
    if (!state) throw new HttpError(400, 'A destination state is required to get a Fez quote', undefined, 'VALIDATION_ERROR');
    const body = await this.send('/order/cost', { method: 'POST', body: JSON.stringify({ state }) });
    // Fez quotes in naira; Hook's provider cost/quote fields are in kobo.
    return { provider: this.name, quoteMinor: Math.round(Number(body.totalCost || 0) * 100), state: body.cost?.state, providerRaw: body };
  }

  async book(input: Record<string, unknown>) {
    const address = readAddress(input);
    if (!address.recipientName || !address.phone || !address.line1 || !address.state) {
      throw new HttpError(400, 'A complete recipient name, phone, address and state are required to book with Fez', undefined, 'VALIDATION_ERROR');
    }
    const hub = (input.hub || {}) as { name?: string; address?: string; phone?: string; stateName?: string };
    const uniqueID = String(input.bookingIdempotencyKey || input.orderId);
    const body = await this.send('/order', {
      method: 'POST',
      body: JSON.stringify([{
        recipientName: address.recipientName,
        recipientPhone: address.phone,
        recipientAddress: address.line1,
        recipientState: address.state,
        uniqueID,
        BatchID: String(input.orderId),
        valueOfItem: String(Math.round(Number(input.totalMinor || 0) / 100)),
        weight: Math.max(1, Math.ceil(Number(input.weightGrams || 1000) / 1000)),
        ...(hub.address ? { thirdparty: true, senderName: hub.name || 'Hook', senderAddress: hub.address, senderPhone: hub.phone, pickUpState: hub.stateName, pickUpAddress: hub.address } : {}),
      }]),
    });
    const orderNo = String(body.orderNos?.[uniqueID] || '');
    if (!orderNo) throw new HttpError(502, 'Fez did not return an order number for this booking', undefined, 'LOGISTICS_PROVIDER_ERROR');
    return { provider: this.name, externalReference: orderNo, trackingNumber: orderNo, status: 'BOOKED_WITH_PROVIDER', providerRaw: body };
  }

  async cancel(reference: string) {
    const body = await this.send('/order/cancel', { method: 'POST', body: JSON.stringify({ orderNo: reference, reason: 'Cancelled by Hook' }) });
    return { reference, provider: this.name, status: 'CANCELLED', providerRaw: body };
  }

  async track(reference: string) {
    const body = await this.send(`/order/track/${encodeURIComponent(reference)}`, { method: 'GET' });
    return { reference, provider: this.name, order: body.order, history: body.history };
  }

  async proofOfDelivery(reference: string) {
    const tracked = await this.track(reference);
    return { reference, provider: this.name, proofOfDelivery: (tracked.order as Record<string, unknown> | undefined)?.proofOfDelivery ?? null };
  }

  async returnShipment(_reference: string): Promise<Record<string, unknown>> {
    // Fez does not document a client-initiated return call; a `Returned` status
    // arrives provider-side via webhook instead (see the webhook status map).
    throw new HttpError(501, 'Fez does not support requesting a return directly; returns are provider-initiated', undefined, 'PROVIDER_NOT_READY');
  }

  parseWebhook(payload: unknown, signature?: string) {
    const body = (payload || {}) as { orderNumber?: string; status?: string; timestamp?: string | number };
    if (signature && body.timestamp) {
      const expected = createHmac('sha256', this.secretKey()).update(`${body.orderNumber || ''}${body.status || ''}${body.timestamp}`).digest('hex');
      if (expected.toLowerCase() !== String(signature).replace(/^sha256=/i, '').trim().toLowerCase()) {
        throw new HttpError(401, 'Invalid Fez webhook signature', undefined, 'WEBHOOK_SIGNATURE_INVALID');
      }
    }
    return { externalReference: body.orderNumber, statusKey: String(body.status || '').toUpperCase().replace(/[ .-]+/g, '_') };
  }
}
