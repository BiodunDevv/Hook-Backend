import { Model } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '@config/data-source';
import { CartItem } from '@models/cart/cart-item.model';
import { CatalogMediaAsset, NegotiatedQuote, ProductSubmission, ProductVariant } from '@models/catalog/catalog.model';
import { VendorCollection, VendorPaymentRecord } from '@models/catalog/market-vendor.model';
import { Negotiation } from '@models/negotiations/negotiation.model';
import { ProductLike } from '@models/products/product-like.model';
import { Product } from '@models/products/product.model';

type AnyModel = Model<any>;
type Target = { label: string; model: AnyModel; filter: Record<string, unknown> };

const execute = process.argv.includes('--execute');

function unique(values: unknown[]) {
  return [...new Set(values.filter(Boolean).map(String))];
}

async function main() {
  await connectDatabase();

  const submissions = await ProductSubmission.find({}).select('_id publicId productId mediaIds').lean();
  const submissionRefs = unique(submissions.flatMap((item) => [item._id, item.publicId]));
  const products = await Product.find({
    $or: [
      { sourceSubmissionId: { $in: submissionRefs } },
      { sourceMarketAssociateId: { $exists: true, $ne: null } },
    ],
  }).select('_id publicId mediaAssetIds').lean();
  const productRefs = unique(products.flatMap((item) => [item._id, item.publicId]));
  const collections = await VendorCollection.find({ productSubmissionId: { $in: submissionRefs } })
    .select('_id publicId')
    .lean();
  const collectionRefs = unique(collections.flatMap((item) => [item._id, item.publicId]));
  const negotiations = await Negotiation.find({ productId: { $in: productRefs } }).select('_id publicId').lean();
  const negotiationRefs = unique(negotiations.flatMap((item) => [item._id, item.publicId]));

  const targets: Target[] = [
    { label: 'Negotiated quotes', model: NegotiatedQuote, filter: { $or: [{ productId: { $in: productRefs } }, { negotiationId: { $in: negotiationRefs } }] } },
    { label: 'Negotiations', model: Negotiation, filter: { productId: { $in: productRefs } } },
    { label: 'Saved products', model: ProductLike, filter: { productId: { $in: productRefs } } },
    { label: 'Cart lines', model: CartItem, filter: { productId: { $in: productRefs } } },
    { label: 'Vendor payment records', model: VendorPaymentRecord, filter: { collectionId: { $in: collectionRefs } } },
    { label: 'Vendor collections', model: VendorCollection, filter: { productSubmissionId: { $in: submissionRefs } } },
    { label: 'Product variants', model: ProductVariant, filter: { productId: { $in: productRefs } } },
    { label: 'Product media records', model: CatalogMediaAsset, filter: { ownerType: 'product', ownerId: { $in: productRefs } } },
    { label: 'Market Associate-created Products', model: Product, filter: { _id: { $in: products.map((item) => item._id) } } },
    { label: 'Submission media records', model: CatalogMediaAsset, filter: { ownerType: 'submission', ownerId: { $in: submissionRefs } } },
    { label: 'Product submissions', model: ProductSubmission, filter: { _id: { $in: submissions.map((item) => item._id) } } },
  ];

  console.log(`${execute ? 'Clearing' : 'Dry run for'} ${submissions.length} Market Associate upload(s) and ${products.length} linked Product(s)`);
  for (const target of targets) {
    const count = await target.model.countDocuments(target.filter);
    if (!count) continue;
    if (execute) await target.model.deleteMany(target.filter);
    console.log(`${execute ? 'Deleted' : 'Would delete'} ${count} ${target.label}`);
  }

  if (!execute) console.log('No data changed. Run with --execute to apply this cleanup.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
