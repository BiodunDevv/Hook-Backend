import dotenv from 'dotenv';
import { connectDatabase, disconnectDatabase } from '@config/data-source';
import { Product } from '@models/products/product.model';

dotenv.config({ quiet: true });

const execute = process.argv.includes('--execute');

/**
 * negotiationRules.enabled defaults to false, so products created outside the
 * commercial-catalog flow never became negotiable even though they already
 * carry a valid minAcceptablePrice. This enables negotiation for those,
 * deriving the rule values from pricing that is already approved:
 *
 *   minimumNegotiablePriceMinor = minAcceptablePrice * 100
 *   maximumDiscountMinor        = sellingPriceMinor - minimumNegotiablePriceMinor
 *
 * which satisfies the same boundary checks commercial-catalog.service.ts
 * enforces when an operator sets these by hand.
 */
async function main() {
  await connectDatabase();

  const products = await Product.find({ deletedAt: { $exists: false } })
    .select('title sellingPrice sellingPriceMinor basePriceMinor minAcceptablePrice negotiationRules')
    .lean();

  const plan: { id: string; title: string; min: number; maxDiscount: number }[] = [];
  const skipped: { title: string; reason: string }[] = [];

  for (const product of products as any[]) {
    if (product.negotiationRules?.enabled) continue;

    const sellingMinor = Number(product.sellingPriceMinor || Math.round(Number(product.sellingPrice || 0) * 100));
    const floorMinor = Math.round(Number(product.minAcceptablePrice || 0) * 100);

    if (!sellingMinor || !floorMinor) {
      skipped.push({ title: product.title, reason: 'missing selling price or negotiation floor' });
      continue;
    }
    if (floorMinor > sellingMinor) {
      skipped.push({ title: product.title, reason: 'negotiation floor above selling price' });
      continue;
    }
    const baseMinor = Number(product.basePriceMinor || 0);
    if (baseMinor && floorMinor < baseMinor) {
      skipped.push({ title: product.title, reason: 'negotiation floor below cost' });
      continue;
    }

    plan.push({
      id: String(product._id),
      title: product.title,
      min: floorMinor,
      maxDiscount: sellingMinor - floorMinor,
    });
  }

  console.log(`Scanned ${products.length} Product(s): ${plan.length} to enable, ${skipped.length} skipped.`);
  for (const item of plan) {
    console.log(`  ${item.title}\n    floor ₦${item.min / 100}, max discount ₦${item.maxDiscount / 100}`);
  }
  for (const item of skipped) console.log(`  SKIP ${item.title} — ${item.reason}`);

  if (!plan.length) {
    console.log('Nothing to change.');
    return;
  }
  if (!execute) {
    console.log(`\nDry run. Re-run with --execute to enable negotiation on ${plan.length} Product(s).`);
    return;
  }

  for (const item of plan) {
    await Product.updateOne({ _id: item.id }, {
      $set: {
        'negotiationRules.enabled': true,
        'negotiationRules.minimumNegotiablePriceMinor': item.min,
        'negotiationRules.maximumDiscountMinor': item.maxDiscount,
      },
      $inc: { catalogVersion: 1 },
    });
  }
  console.log(`\nEnabled negotiation on ${plan.length} Product(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
