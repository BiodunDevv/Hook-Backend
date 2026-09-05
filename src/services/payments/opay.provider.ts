import { createHash, createHmac, timingSafeEqual } from "crypto";
import { HttpError } from "@utils/http";
import type {
  PaymentProvider,
  ProviderInitializeInput,
  ProviderTransaction,
} from "./payment-provider";

export class OpayProvider implements PaymentProvider {
  readonly name = "opay" as const;
  private readonly testBase = "https://testapi.opaycheckout.com/api/v1/international";
  private readonly liveBase = "https://liveapi.opaycheckout.com/api/v1/international";

  private get mode(): "live" | "test" {
    return this.baseUrl.startsWith(this.testBase) ? "test" : "live";
  }

  private get baseUrl() {
    if (process.env.OPAY_PAYIN_BASE_URL) {
      return process.env.OPAY_PAYIN_BASE_URL.replace(/\/$/, "");
    }
    return this.liveBase;
  }

  readiness() {
    const missing = [
      ["OPAY_PAYIN_PUBLIC_KEY", process.env.OPAY_PAYIN_PUBLIC_KEY],
      ["OPAY_PAYIN_SECRET_KEY", process.env.OPAY_PAYIN_SECRET_KEY],
      ["OPAY_PAYIN_MERCHANT_ID", process.env.OPAY_PAYIN_MERCHANT_ID],
      ["OPAY_PAYIN_CALLBACK_URL", process.env.OPAY_PAYIN_CALLBACK_URL],
    ].filter(([, value]) => !value).map(([key]) => key);
    return {
      configured: missing.length === 0,
      mode: this.mode,
      reason: missing.length ? `Missing ${missing.join(", ")}` : undefined,
    };
  }

  async initialize(input: ProviderInitializeInput) {
    this.assertConfigured();
    const payload = {
      country: "NG",
      reference: input.reference,
      amount: { total: input.amountMinor, currency: input.currency },
      returnUrl: input.callbackUrl,
      callbackUrl: process.env.OPAY_PAYIN_CALLBACK_URL,
      cancelUrl: input.callbackUrl,
      expireAt: 15,
      customerVisitSource: "BROWSER",
      userInfo: { userEmail: input.email },
      product: { name: `Hook order ${input.reference}`, description: "Hook marketplace order" },
    };
    const data = await this.request("/cashier/create", payload, "public");
    const authorizationUrl = String(data.cashierUrl || data.cashierURL || data.authorizationUrl || "");
    if (!authorizationUrl) {
      throw new HttpError(502, "Payment provider returned an invalid checkout response", undefined, "PAYMENT_PROVIDER_ERROR");
    }
    return { authorizationUrl, accessCode: "", reference: input.reference };
  }

  async verify(reference: string): Promise<ProviderTransaction> {
    this.assertConfigured();
    const data = await this.request("/cashier/status", { reference, country: "NG" }, "secret");
    const amount = data.amount && typeof data.amount === "object" ? data.amount as Record<string, unknown> : {};
    return {
      reference: String(data.reference || reference),
      status: this.normalizeStatus(String(data.status || data.paymentStatus || "")),
      amountMinor: Number(amount.total ?? data.amount ?? 0),
      currency: String(amount.currency ?? data.currency ?? "NGN").toUpperCase(),
      providerId: data.transactionId ? String(data.transactionId) : undefined,
      paidAt: data.timestamp ? new Date(String(data.timestamp)) : undefined,
      raw: data,
    };
  }

  async refund(input: { reference: string; amountMinor: number; reason?: string }) {
    const data = await this.request("/payment/refund/create", {
      reference: `RF-${input.reference}-${Date.now()}`,
      originalReference: input.reference,
      amount: { total: input.amountMinor, currency: "NGN" },
      country: "NG",
      reason: input.reason,
    }, "secret");
    return { providerReference: String(data.reference || data.transactionId || input.reference) };
  }

  parseWebhook(rawBody: Buffer, signature: string) {
    this.assertConfigured();
    let payload: Record<string, any>;
    try { payload = JSON.parse(rawBody.toString("utf8")); }
    catch { throw new HttpError(400, "Invalid webhook payload"); }
    if (!this.verifyCallback(payload, signature)) {
      throw new HttpError(401, "Invalid webhook signature", undefined, "WEBHOOK_SIGNATURE_INVALID");
    }
    const data = payload.payload && typeof payload.payload === "object" ? payload.payload : payload;
    const reference = data.reference ? String(data.reference) : undefined;
    return {
      eventType: this.normalizeStatus(String(data.status || payload.type || "")) === "success" ? "charge.success" : String(payload.type || data.status || ""),
      providerEventId: String(data.transactionId || payload.id || `${reference || "unknown"}:${createHash("sha256").update(rawBody).digest("hex")}`),
      reference,
      payload,
    };
  }

  private verifyCallback(payload: Record<string, any>, signature: string) {
    if (!signature) return false;
    const data = payload.payload && typeof payload.payload === "object" ? payload.payload : payload;
    const canonical = `{Amount:"${String(data.amount ?? "")}",Currency:"${String(data.currency ?? "")}",Reference:"${String(data.reference ?? "")}",Refunded:${data.refunded ? "t" : "f"},Status:"${String(data.status ?? "")}",Timestamp:"${String(data.timestamp ?? "")}",Token:"${String(data.token ?? "")}",TransactionID:"${String(data.transactionId ?? "")}"}`;
    const expected = createHmac("sha3-512", process.env.OPAY_PAYIN_SECRET_KEY!).update(canonical).digest("hex");
    const supplied = String(signature).trim().toLowerCase();
    return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  }

  private normalizeStatus(value: string) {
    return ["success", "successful", "completed", "paid"].includes(value.toLowerCase()) ? "success" : value.toLowerCase();
  }

  private async request(path: string, payload: Record<string, unknown>, auth: "public" | "secret") {
    this.assertConfigured();
    const body = JSON.stringify(payload);
    const merchantId = String(process.env.OPAY_PAYIN_MERCHANT_ID || "").trim();
    const publicKey = String(process.env.OPAY_PAYIN_PUBLIC_KEY || "").trim();
    const secretKey = String(process.env.OPAY_PAYIN_SECRET_KEY || "").trim();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          MerchantId: merchantId,
          Authorization: auth === "public"
            ? `Bearer ${publicKey}`
            : `Bearer ${createHmac("sha512", secretKey).update(body).digest("hex")}`,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new HttpError(503, "Payment provider is temporarily unavailable", undefined, "PAYMENT_PROVIDER_UNAVAILABLE");
    }
    const envelope = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok || !["00000", "SUCCESS", "0"].includes(String(envelope.code || envelope.status || ""))) {
      const providerCode = String(envelope.code || envelope.status || response.status || "UNKNOWN");
      const providerMessage = String(envelope.message || envelope.msg || "OPay rejected the request").slice(0, 240);
      console.warn(JSON.stringify({ event: "opay_request_rejected", path, providerCode, providerMessage, httpStatus: response.status }));
      const safeMessages: Record<string, string> = {
        "00003": "OPay could not find this Merchant ID. Use credentials from the same sandbox or live environment as the configured OPay endpoint.",
        "02000": "OPay authentication failed. Check the Merchant ID and matching API keys.",
        "02001": "OPay rejected the payment details. Please verify the checkout configuration.",
        "02002": "OPay Cashier is not enabled for this merchant account.",
        "02003": "The selected OPay payment method is unavailable.",
        "02004": "This OPay payment reference has already been used.",
        "02007": "This OPay merchant account is currently unavailable.",
        "50003": "OPay is temporarily unavailable. Please try again.",
      };
      throw new HttpError(502, safeMessages[providerCode] || "OPay could not start this payment. Please try again.", { providerCode }, "PAYMENT_PROVIDER_ERROR");
    }
    return (envelope.data || envelope) as Record<string, any>;
  }

  private assertConfigured() {
    if (!this.readiness().configured) {
      throw new HttpError(503, "OPay is not configured", undefined, "PAYMENT_PROVIDER_UNAVAILABLE");
    }
  }
}
