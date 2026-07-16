import { connectDatabase, disconnectDatabase } from '@config/data-source';
import { normalizeProductColor, normalizeProductColors } from '@lib/product-color';
import { CartItem } from '@models/cart/cart-item.model';
import { Product } from '@models/products/product.model';

function variantKey(color?: string, size?: string) {
  const normalizedColor = String(color || '').trim().toLowerCase();
  const normalizedSize = String(size || '').trim().toLowerCase();
  return normalizedColor || normalizedSize ? `${normalizedColor || '-'}::${normalizedSize || '-'}` : 'default';
}

async function migrate() {
  await connectDatabase();
  const products = await Product.find({ colors: { $exists: true, $ne: [] } }).select('_id colors').lean();
  const productUpdates = products.flatMap((product: any) => {
    const colors = normalizeProductColors(product.colors);
    return JSON.stringify(colors) === JSON.stringify(product.colors) ? [] : [{
      updateOne: { filter: { _id: product._id }, update: { $set: { colors } } },
    }];
  });
  if (productUpdates.length) await Product.bulkWrite(productUpdates as any);

  const cartItems = await CartItem.find({ 'selectedVariants.color': { $exists: true } }).select('_id selectedVariants').lean();
  const cartUpdates = cartItems.flatMap((item: any) => {
    const color = normalizeProductColor(item.selectedVariants?.color);
    if (!color || color === item.selectedVariants?.color) return [];
    return [{ updateOne: {
      filter: { _id: item._id },
      update: { $set: { 'selectedVariants.color': color, variantKey: variantKey(color, item.selectedVariants?.size) } },
    } }];
  });
  if (cartUpdates.length) await CartItem.bulkWrite(cartUpdates as any);
  console.log(`Product color migration complete (${productUpdates.length} products, ${cartUpdates.length} cart items updated)`);
}

migrate().then(disconnectDatabase).catch(async (error) => {
  console.error('Product color migration failed:', error instanceof Error ? error.message : error);
  await disconnectDatabase();
  process.exitCode = 1;
});
