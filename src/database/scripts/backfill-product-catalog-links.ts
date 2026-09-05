import dotenv from 'dotenv';
import { connectDatabase, disconnectDatabase } from '@config/data-source';
import { ProductAvailabilityStatus, ProductStatus } from '@lib/constants';
import { Category } from '@models/categories/category.model';
import { CommerceSettings } from '@models/commerce/commerce.model';
import { Market } from '@models/platform/network.model';
import { Product } from '@models/products/product.model';

dotenv.config({ quiet: true });

const execute = process.argv.includes('--execute');

function identifier(value: unknown) {
  const id = String(value || '');
  if (!id) return null;
  return /^[a-f\d]{24}$/i.test(id) ? { _id: id } : { publicId: id };
}

function publicationGaps(product: any, category: any, market: any) {
  return [
    ...(!category?.isActive ? ['active category'] : []),
    ...(market?.status !== 'active' ? ['active Market'] : []),
    ...(String(product.description || '').trim().length < 20 ? ['description'] : []),
    ...(!product.images?.length ? ['images'] : []),
    ...(Number(product.quantity || 0) < 1 ? ['stock'] : []),
    ...(Number(product.costPrice || 0) <= 0 ? ['market price'] : []),
    ...(Number(product.sellingPrice || 0) <= 0 ? ['Hook price'] : []),
  ];
}

async function main() {
  await connectDatabase();
  const settings = await CommerceSettings.findOne({ key: 'commerce' }).select('catalogAvailabilityCheckDays').lean();
  const days = Math.min(Math.max(Number(settings?.catalogAvailabilityCheckDays || 4), 1), 30);
  const defaultMarket = await Market.findOne({ status: 'active' }).sort({ isFeatured: -1, displayPriority: 1, name: 1 }).lean();
  if (!defaultMarket) throw new Error('No active Market is available for legacy product assignment');
  const products = await Product.find({ deletedAt: { $exists: false } });
  let ready = 0;
  let incomplete = 0;

  for (const product of products) {
    const [category, linkedMarket] = await Promise.all([
      product.categoryId ? Category.findOne(identifier(product.categoryId) as any).lean() : null,
      product.marketId ? Market.findOne(identifier(product.marketId) as any).lean() : null,
    ]);
    // Products created through the old Admin form had no Market field. Keep
    // them usable by assigning the highest-priority active Market; Admin can
    // now move each listing through the Product edit workflow.
    const market = linkedMarket || defaultMarket;
    const gaps = publicationGaps(product, category, market);
    const canPublish = gaps.length === 0;
    const shouldPublish = canPublish && [ProductStatus.APPROVED, ProductStatus.PUBLISHED].includes(product.status);
    const now = new Date();
    const updates: Record<string, unknown> = {
      ...(category ? { categoryId: String(category._id) } : {}),
      ...(market ? { marketId: String(market._id), sourceStateId: market.stateId } : {}),
      basePriceMinor: Math.round(Number(product.costPrice || 0) * 100),
      sellingPriceMinor: Math.round(Number(product.sellingPrice || 0) * 100),
      discountMinor: product.discountedPrice
        ? Math.max(0, Math.round((Number(product.sellingPrice) - Number(product.discountedPrice)) * 100))
        : Number(product.discountMinor || 0),
      currency: product.currency || 'NGN',
      catalogVersion: Number(product.catalogVersion || 1) + 1,
      ...(shouldPublish ? {
        status: ProductStatus.PUBLISHED,
        availabilityStatus: [ProductAvailabilityStatus.AVAILABLE, ProductAvailabilityStatus.LIMITED].includes(product.availabilityStatus)
          ? product.availabilityStatus
          : ProductAvailabilityStatus.AVAILABLE,
        publishedAt: product.publishedAt || now,
        lastAvailabilityConfirmedAt: product.lastAvailabilityConfirmedAt || now,
        availabilityValidUntil: product.availabilityValidUntil || new Date(now.getTime() + days * 86_400_000),
        commercialApproval: product.commercialApproval?.approved
          ? product.commercialApproval
          : { approved: true, approvedAt: now },
      } : {}),
    };

    if (canPublish) ready += 1;
    else incomplete += 1;
    console.log(`${execute ? 'Updating' : 'Would update'} ${product.hookId || product.publicId || product.id}: ${canPublish ? 'catalog-ready' : `kept non-public; missing ${gaps.join(', ')}`}${!linkedMarket ? `; assigned ${defaultMarket.name}` : ''}`);
    if (execute) await Product.updateOne({ _id: product._id }, { $set: updates });
  }

  console.log(`${execute ? 'Updated' : 'Inspected'} ${products.length} products (${ready} ready, ${incomplete} incomplete).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
