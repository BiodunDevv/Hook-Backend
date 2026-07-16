import { connectDatabase, disconnectDatabase } from '@config/data-source';
import { CartItem } from '@models/cart/cart-item.model';

function variantKey(selected?: { color?: string; size?: string }) {
  const color = String(selected?.color || '').trim().toLowerCase();
  const size = String(selected?.size || '').trim().toLowerCase();
  return color || size ? `${color || '-'}::${size || '-'}` : 'default';
}

async function migrate() {
  await connectDatabase();
  const rows = await CartItem.find({ $or: [{ variantKey: { $exists: false } }, { variantKey: '' }] }).select('_id selectedVariants').lean();
  if (rows.length) {
    await CartItem.bulkWrite(rows.map((row: any) => ({
      updateOne: { filter: { _id: row._id }, update: { $set: { variantKey: variantKey(row.selectedVariants) } } },
    })));
  }

  const indexes = await CartItem.collection.indexes();
  if (indexes.some((index) => index.name === 'cartId_1_productId_1')) {
    await CartItem.collection.dropIndex('cartId_1_productId_1');
  }
  await CartItem.collection.createIndex({ cartId: 1, productId: 1, variantKey: 1 }, { unique: true, name: 'cartId_1_productId_1_variantKey_1' });
  console.log(`Cart variant migration complete (${rows.length} rows backfilled)`);
}

migrate().then(disconnectDatabase).catch(async (error) => {
  console.error('Cart variant migration failed:', error instanceof Error ? error.message : error);
  await disconnectDatabase();
  process.exitCode = 1;
});
