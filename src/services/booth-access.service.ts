import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { Booth } from '@models/booths/booth.model';
import { BoothInventory } from '@models/booths/booth-inventory.model';
import { Product } from '@models/products/product.model';
import { Category } from '@models/categories/category.model';
import { Vendor } from '@models/vendors/vendor.model';
import { ProductStatus } from '@lib/constants';
import { HttpError } from '@utils/http';
import { normalizeProductColors } from '@lib/product-color';

export type BoothSession = { boothId: string; source: 'code' | 'qr'; version: number; qrVersion: number };

function accessSecret() {
  const value = process.env.BOOTH_ACCESS_SECRET || process.env.JWT_SECRET;
  if (!value) throw new HttpError(503, 'Booth access is not configured');
  return value;
}

function sessionSecret() {
  return process.env.BOOTH_SESSION_SECRET || accessSecret();
}

export class BoothAccessService {
  digestCode(code: string) {
    return createHmac('sha256', accessSecret()).update(code).digest('hex');
  }

  digestQrToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async generateUniqueCode() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const exists = await Booth.exists({ accessCodeDigest: this.digestCode(code) });
      if (!exists) return code;
    }
    throw new HttpError(503, 'Could not generate a booth access code');
  }

  generateQrCredential() {
    const token = randomBytes(32).toString('base64url');
    return { publicId: randomBytes(12).toString('hex'), token, tokenDigest: this.digestQrToken(token) };
  }

  async resolveCode(rawCode: string) {
    const code = rawCode.replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) throw new HttpError(404, 'Booth access code is invalid');
    const booth = await Booth.findOne({ accessCodeDigest: this.digestCode(code), isActive: true }).select('+accessCodeDigest');
    if (!booth) throw new HttpError(404, 'Booth access code is invalid');
    return this.response(booth, 'code');
  }

  async resolveQr(publicId: string, token: string) {
    const booth = await Booth.findOne({ qrPublicId: publicId, isActive: true }).select('+qrTokenHash');
    const actual = this.digestQrToken(token || '');
    const expected = booth?.qrTokenHash || ''.padEnd(64, '0');
    const matches = expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
    if (!booth || !token || !matches) throw new HttpError(404, 'Booth QR code is invalid');
    return this.response(booth, 'qr');
  }

  verifySession(token: string): BoothSession {
    try {
      const payload = jwt.verify(token, sessionSecret(), { algorithms: ['HS256'] }) as jwt.JwtPayload;
      if (payload.typ !== 'booth' || !payload.boothId) throw new Error('invalid');
      return { boothId: String(payload.boothId), source: payload.source, version: Number(payload.version), qrVersion: Number(payload.qrVersion) };
    } catch {
      throw new HttpError(401, 'Booth session is invalid or expired');
    }
  }

  async assertCurrent(session: BoothSession) {
    const booth = await Booth.findById(session.boothId);
    if (!booth?.isActive || booth.accessCodeVersion !== session.version || booth.qrVersion !== session.qrVersion) {
      throw new HttpError(401, 'Booth session is invalid or expired');
    }
    return booth;
  }

  async resolveSession(token: string) {
    const session = this.verifySession(token);
    const booth = await this.assertCurrent(session);
    return this.response(booth, session.source);
  }

  async resolveProduct(token: string, productId: string) {
    const session = this.verifySession(token);
    const booth = await this.assertCurrent(session);
    const assignment = await BoothInventory.findOne({ boothId: booth.id, productId, isActive: true }).lean();
    if (!assignment) throw new HttpError(404, 'This product is not available from this booth');
    const product = await Product.findOne({ _id: productId, status: ProductStatus.APPROVED }).lean({ virtuals: true });
    if (!product) throw new HttpError(404, 'This product is no longer available');
    const [category, vendor] = await Promise.all([
      Category.findById(product.categoryId).lean({ virtuals: true }),
      Vendor.findById(product.vendorId).lean({ virtuals: true }),
    ]);
    return {
      booth: this.safeBooth(booth),
      product: this.normalizeProduct(product, category, vendor),
      boothSessionToken: this.signSession(booth, session.source),
      expiresInSeconds: 1800,
    };
  }

  private async response(booth: any, source: 'code' | 'qr') {
    const inventory = await BoothInventory.find({ boothId: booth.id, isActive: true }).lean();
    const productRows = inventory.length ? await Product.find({
      _id: { $in: inventory.map((row) => row.productId) }, status: ProductStatus.APPROVED,
    }).lean({ virtuals: true }) : [];
    const categoryIds = [...new Set(productRows.map((product) => String(product.categoryId)))];
    const vendorIds = [...new Set(productRows.map((product) => String(product.vendorId)))];
    const [categoryRows, vendorRows] = await Promise.all([
      Category.find({ _id: { $in: categoryIds }, isActive: true }).sort({ sortOrder: 1, name: 1 }).lean({ virtuals: true }),
      Vendor.find({ _id: { $in: vendorIds }, isActive: true, isApproved: true }).lean({ virtuals: true }),
    ]);
    const categoriesById = new Map(categoryRows.map((row: any) => [String(row._id), row]));
    const vendorsById = new Map(vendorRows.map((row: any) => [String(row._id), row]));
    const products = productRows.map((product: any) => this.normalizeProduct(product, categoriesById.get(String(product.categoryId)), vendorsById.get(String(product.vendorId))));
    const categoryCounts = new Map<string, number>();
    for (const product of products) categoryCounts.set(product.categoryId, (categoryCounts.get(product.categoryId) || 0) + 1);
    const categories = categoryRows.map((category: any) => ({
      id: String(category._id), name: category.name, slug: category.slug, iconUrl: category.iconUrl,
      productCount: categoryCounts.get(String(category._id)) || 0,
    })).filter((category) => category.productCount > 0);
    return {
      booth: this.safeBooth(booth), products, categories, total: products.length,
      boothSessionToken: this.signSession(booth, source), expiresInSeconds: 1800,
    };
  }

  private signSession(booth: any, source: 'code' | 'qr') {
    return jwt.sign({ typ: 'booth', boothId: booth.id, source, version: booth.accessCodeVersion, qrVersion: booth.qrVersion }, sessionSecret(), { algorithm: 'HS256', expiresIn: '30m' });
  }

  private safeBooth(booth: any) {
    const safe = typeof booth.toJSON === 'function' ? booth.toJSON() : { ...booth, id: String(booth._id || booth.id) };
    delete safe._id;
    delete safe.accessCodeDigest;
    delete safe.qrTokenHash;
    return safe;
  }

  private normalizeProduct(product: any, category?: any, vendor?: any) {
    const id = String(product._id || product.id);
    const availableQuantity = Math.max(0, Number(product.quantity || 0) - Number(product.reservedQuantity || 0));
    return {
      ...product, _id: undefined, id, images: Array.isArray(product.images) ? product.images.filter(Boolean) : [],
      colors: normalizeProductColors(product.colors),
      categoryId: String(product.categoryId), vendorId: String(product.vendorId), availableQuantity,
      isAvailable: availableQuantity > 0,
      category: category ? { id: String(category._id || category.id), name: category.name, slug: category.slug, iconUrl: category.iconUrl } : undefined,
      vendor: vendor ? { id: String(vendor._id || vendor.id), businessName: vendor.businessName, imageUrl: vendor.imageUrl } : undefined,
    };
  }
}
