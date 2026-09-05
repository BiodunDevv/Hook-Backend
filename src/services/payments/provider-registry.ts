import { HttpError } from "@utils/http";
import type { PaymentProvider } from "./payment-provider";
import { OpayProvider } from "./opay.provider";
import { PaystackProvider } from "./paystack.provider";

export type ProviderName = "paystack" | "opay";

const providers: Record<ProviderName, PaymentProvider> = {
  paystack: new PaystackProvider(),
  opay: new OpayProvider(),
};

export function paymentProvider(name: ProviderName) {
  const provider = providers[name];
  if (!provider) throw new HttpError(400, "Unsupported payment provider", undefined, "PAYMENT_PROVIDER_NOT_SUPPORTED");
  return provider;
}

export function paymentProviderReadiness() {
  return (Object.keys(providers) as ProviderName[]).map((name) => ({ provider: name, ...providers[name].readiness() }));
}
