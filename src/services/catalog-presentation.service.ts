import { Category } from '@models/categories/category.model';
import { Market } from '@models/platform/network.model';
import { OperationState } from '@models/platform/geography.model';
import { MarketAssociateProfile } from '@models/platform/operations-accounts.model';
import { User } from '@models/users/user.model';
import { CatalogMediaAsset } from '@models/catalog/catalog.model';
import { MarketVendor } from '@models/catalog/market-vendor.model';
import { Product } from '@models/products/product.model';
import { CatalogMediaService } from './catalog-media.service';

async function marketAssociateName(record: any) {
  // If a caller already attached a presented marketAssociate (e.g. a nested
  // fetch elsewhere), trust it and skip the lookup.
  if (record.marketAssociate?.publicId) return record.marketAssociate;
  const profile = await MarketAssociateProfile.findById(record.marketAssociateId).select('publicId accountId').lean({ virtuals: true });
  if (!profile) return null;
  const account = await User.findById(profile.accountId).select('firstName lastName').lean();
  const name = [account?.firstName, account?.lastName].filter(Boolean).join(' ').trim();
  return { publicId: profile.publicId, name: name || undefined };
}

export async function presentSubmission(record: any) {
  const [market, category, state, marketAssociate, rawMedia, product, marketVendor] = await Promise.all([
    record.market?.publicId
      ? record.market
      : Market.findById(record.marketId).select('publicId name').lean({ virtuals: true }),
    record.category?.publicId
      ? record.category
      : Category.findById(record.categorySuggestionId).select('publicId name slug').lean({ virtuals: true }),
    OperationState.findById(record.sourceStateId).select('publicId name code').lean({ virtuals: true }),
    marketAssociateName(record),
    record.media
      ? record.media
      : CatalogMediaAsset.find({
          $or: [
            { publicId: { $in: record.mediaIds || [] } },
            { _id: { $in: (record.mediaIds || []).filter((id: string) => /^[a-f\d]{24}$/i.test(id)) } },
          ],
          status: 'ready',
        }).sort({ order: 1 }).lean({ virtuals: true }),
    record.productId
      ? Product.findById(record.productId).select('publicId sellingPriceMinor minAcceptablePrice sellingPrice costPrice currency status publishedAt').lean({ virtuals: true })
      : null,
    record.marketVendorId
      ? MarketVendor.findOne({ $or: [{ publicId: record.marketVendorId }, { _id: record.marketVendorId }] }).select('publicId businessName contactName').lean({ virtuals: true })
      : null,
  ]);
  const mediaService = new CatalogMediaService();
  const media = rawMedia.map((asset: any) => ({
    ...asset,
    deliveryUrl: asset.deliveryUrl
      || (asset.deliveryType === 'external' ? asset.secureUrl : mediaService.deliveryUrl(asset)),
  }));
  return {
    id: record.publicId,
    publicId: record.publicId,
    marketAssociate: marketAssociate ? { publicId: marketAssociate.publicId, name: marketAssociate.name } : null,
    marketId: market?.publicId,
    market: market ? { publicId: market.publicId, name: market.name } : null,
    sourceStateId: state?.publicId,
    sourceState: state ? { publicId: state.publicId, name: state.name, code: state.code } : null,
    categorySuggestionId: category?.publicId,
    category: category ? { publicId: category.publicId, name: category.name, slug: category.slug } : null,
    marketVendorId: marketVendor?.publicId || record.marketVendorId,
    marketVendor: marketVendor ? { publicId: marketVendor.publicId, businessName: marketVendor.businessName, contactName: marketVendor.contactName } : null,
    internalSellerReference: record.internalSellerReference,
    basicTitle: record.basicTitle,
    notes: record.notes,
    mediaIds: media.map((asset: any) => asset.publicId),
    media: media.map((asset: any) => ({
      publicId: asset.publicId,
      deliveryUrl: asset.deliveryUrl,
      width: asset.width,
      height: asset.height,
      format: asset.format,
    })),
    imageUrl: media[0]?.deliveryUrl,
    basePriceMinor: record.basePriceMinor,
    currency: record.currency,
    variants: record.variants || [],
    availabilityStatus: record.availabilityStatus,
    availabilityNote: record.availabilityNote,
    status: record.status,
    reviewNotes: record.reviewNotes || [],
    submittedAt: record.submittedAt,
    reviewStartedAt: record.reviewStartedAt,
    reviewedAt: record.reviewedAt,
    productId: product?.publicId,
    approvedProduct: product ? {
      publicId: product.publicId,
      sellingPriceMinor: product.sellingPriceMinor ?? Number(product.sellingPrice || 0) * 100,
      minimumPriceMinor: Number(product.minAcceptablePrice || 0) * 100,
      observedCostMinor: Number(product.costPrice || 0) * 100,
      currency: product.currency || record.currency,
      status: product.status,
      publishedAt: product.publishedAt,
    } : null,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function presentCommercialSummary(record: any) {
  return {
    id: record.publicId,
    publicId: record.publicId,
    title: record.title,
    slug: record.slug,
    description: record.description,
    status: record.status,
    catalogVersion: record.catalogVersion,
    pricing: record.pricing,
    negotiationRules: record.negotiationRules,
    availabilityStatus: record.availabilityStatus,
    customerAvailabilityNote: record.customerAvailabilityNote,
    category: record.category ? {
      publicId: record.category.publicId,
      name: record.category.name,
      slug: record.category.slug,
    } : null,
    market: record.market ? {
      publicId: record.market.publicId,
      name: record.market.name,
    } : null,
    variants: (record.variants || []).map((variant: any) => ({
      publicId: variant.publicId,
      size: variant.size,
      colour: variant.colour,
      attributes: variant.attributes || {},
      active: variant.active,
    })),
    media: (record.media || []).map((asset: any) => ({
      publicId: asset.publicId,
      deliveryUrl: asset.deliveryUrl,
      secureUrl: asset.secureUrl,
      width: asset.width,
      height: asset.height,
      format: asset.format,
    })),
    publishedAt: record.publishedAt,
    updatedAt: record.updatedAt,
  };
}
