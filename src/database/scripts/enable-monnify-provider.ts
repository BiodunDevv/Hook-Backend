import { connectDatabase, disconnectDatabase } from '@config/data-source';
import { CommerceSettings } from '@models/commerce/commerce.model';

const execute = process.argv.includes('--execute');

/**
 * Adds Monnify to CommerceSettings.paymentProviders as the default provider,
 * keeping Paystack enabled but no longer default. New checkouts will pick it
 * up via defaultProviderName(); existing Payment/PaymentAttempt rows are
 * untouched, since they already carry their own `gateway`/`provider` value
 * set at creation time and always dispatch through that, not this setting.
 *
 * Run this only after MONNIFY_API_KEY / MONNIFY_SECRET_KEY / MONNIFY_CONTRACT_CODE
 * are configured and readiness() reports Monnify as configured — flipping the
 * default before that would send new checkouts to a provider that can't
 * actually initialize a payment.
 */
async function main() {
  await connectDatabase();
  const settings = await CommerceSettings.findOne({ key: 'commerce' }).select('paymentProviders');
  if (!settings) {
    console.log('No CommerceSettings document found. Nothing to do.');
    return;
  }
  const providers = settings.paymentProviders || [];
  if (providers.some((entry: any) => entry.provider === 'monnify')) {
    console.log('Monnify is already registered in paymentProviders. Nothing to do.');
    return;
  }
  const next = [
    { provider: 'monnify', enabled: true, displayOrder: 1, isDefault: true },
    ...providers.map((entry: any) => ({ ...entry, isDefault: false, displayOrder: entry.displayOrder < 2 ? 2 : entry.displayOrder })),
  ];
  console.log(`${execute ? 'Updating' : 'Dry run for'} paymentProviders:`);
  console.log(JSON.stringify(next, null, 2));
  if (execute) {
    await CommerceSettings.updateOne({ key: 'commerce' }, { $set: { paymentProviders: next } });
    console.log('Monnify is now the default payment provider. Paystack stays enabled as fallback.');
  } else {
    console.log('No data changed. Run with --execute to apply.');
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => disconnectDatabase());
