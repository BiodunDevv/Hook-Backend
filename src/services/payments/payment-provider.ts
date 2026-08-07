export type ProviderInitializeInput = {
  reference: string;
  amountMinor: number;
  currency: string;
  email: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
};
export type ProviderTransaction = {
  reference: string;
  status: string;
  amountMinor: number;
  currency: string;
  providerId?: string;
  paidAt?: Date;
  raw: Record<string, unknown>;
};

export interface PaymentProvider {
  readonly name: "paystack";
  initialize(
    input: ProviderInitializeInput,
  ): Promise<{
    authorizationUrl: string;
    accessCode: string;
    reference: string;
  }>;
  verify(reference: string): Promise<ProviderTransaction>;
  refund(input: { reference: string; amountMinor: number; reason?: string }): Promise<{ providerReference: string }>;
  parseWebhook(
    rawBody: Buffer,
    signature: string,
  ): {
    eventType: string;
    providerEventId: string;
    reference?: string;
    payload: Record<string, any>;
  };
}
