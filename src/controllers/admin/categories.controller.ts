import { Request, Response } from 'express';
import { UserRole } from '@lib/constants';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminRepos, actor, routeParam } from './admin.helpers';
import { nextPublicId } from '@services/public-id.service';
import { publishRealtime } from '@services/realtime.service';
import { Product } from '@models/products/product.model';
import { User } from '@models/users/user.model';
import { adminCategoryCache } from '@lib/ttl-cache';

const MANAGER_ROLES: UserRole[] = [UserRole.SUPPORT, UserRole.ADMIN];

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'category';
}

function toManager(user: any) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone || null,
    role: user.role,
  };
}

function publishCategoryUpdate(category: any) {
  const event = {
    entityId: category.publicId || category.id,
    version: Number(category.version || 1),
  };
  publishRealtime({ type: 'catalog.updated', entityType: 'category', ...event }, { public: true, admin: true });
  publishRealtime({ type: 'home.updated', entityType: 'category', ...event }, { public: true, admin: true });
  publishRealtime({ type: 'admin.dashboard.updated', ...event }, { admin: true });
}

async function loadEnrichment() {
  const [products, users] = await Promise.all([
    Product.aggregate([
      { $match: { categoryId: { $exists: true }, deletedAt: { $exists: false } } },
      { $group: { _id: '$categoryId', count: { $sum: 1 } } },
    ]),
    User.find({ role: { $in: MANAGER_ROLES }, isActive: true, assignedCategoryIds: { $exists: true, $ne: [] } })
      .select('publicId firstName lastName email phone role assignedCategoryIds')
      .lean({ virtuals: true }),
  ]);

  const productCounts = new Map<string, number>();
  for (const product of products as any[]) {
    productCounts.set(String(product._id), Number(product.count || 0));
  }

  const managersByCategory = new Map<string, any[]>();
  for (const user of users as any[]) {
    if (!MANAGER_ROLES.includes(user.role)) continue;
    for (const categoryId of user.assignedCategoryIds || []) {
      const bucket = managersByCategory.get(categoryId) || [];
      bucket.push(toManager(user));
      managersByCategory.set(categoryId, bucket);
    }
  }

  return { productCounts, managersByCategory };
}

export class AdminCategoriesController {
  list = async (_req: Request, res: Response) => {
    const cached = adminCategoryCache.get('list');
    if (cached) {
      sendSuccess(res, { data: cached, total: cached.length });
      return;
    }
    const [categories, { productCounts, managersByCategory }] = await Promise.all([
      adminRepos.categories().find({ order: { sortOrder: 'ASC', name: 'ASC' } }),
      loadEnrichment(),
    ]);

    const data = (categories as any[]).map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description || '',
      iconUrl: category.iconUrl || null,
      sortOrder: category.sortOrder ?? 0,
      isActive: category.isActive,
      createdAt: category.createdAt,
      productCount: productCounts.get(category.id) || 0,
      managers: managersByCategory.get(category.id) || [],
      hasSizingGuide: Boolean(category.attributeSchema?.sizingGuide?.summary),
      attributeSchema: { sizingGuide: category.attributeSchema?.sizingGuide || null },
    }));

    adminCategoryCache.set('list', data);
    sendSuccess(res, { data, total: data.length });
  };

  detail = async (req: Request, res: Response) => {
    const category: any = await adminRepos.categories().findOne({ where: { id: routeParam(req.params.id) } });
    if (!category) throw new HttpError(404, 'Category not found');

    const { productCounts, managersByCategory } = await loadEnrichment();

    sendSuccess(res, {
      ...category,
      productCount: productCounts.get(category.id) || 0,
      managers: managersByCategory.get(category.id) || [],
    });
  };

  create = async (req: Request, res: Response) => {
    const categories = adminRepos.categories();
    const name = String(req.body.name).trim();
    const slug = slugify(name);

    const existing: any = await categories.findOne({ where: [{ name }, { slug }] as any });
    if (existing) throw new HttpError(400, `A category named "${existing.name}" already exists`);

    const category = await categories.save(categories.create({
      publicId: await nextPublicId('category'),
      name,
      slug,
      description: req.body.description || '',
      iconUrl: req.body.iconUrl,
      sortOrder: req.body.sortOrder ?? 0,
      isActive: true,
      attributeSchema: req.body.sizingGuide ? { sizingGuide: req.body.sizingGuide } : {},
    }));

    const auditLogs = adminRepos.auditLogs();
    await auditLogs.save(auditLogs.create({
      action: 'category.create',
      resourceType: 'category',
      resourceId: (category as any).id,
      details: `Created category "${name}"`,
      status: 'success',
      ...actor(req),
    }));

    publishCategoryUpdate(category);
    adminCategoryCache.clear();
    sendCreated(res, category);
  };

  update = async (req: Request, res: Response) => {
    const categories = adminRepos.categories();
    const category: any = await categories.findOne({ where: { id: routeParam(req.params.id) } });
    if (!category) throw new HttpError(404, 'Category not found');

    if (req.body.name && String(req.body.name).trim() !== category.name) {
      const name = String(req.body.name).trim();
      const slug = slugify(name);
      const clash: any = await categories.findOne({ where: [{ name }, { slug }] as any });
      if (clash && clash.id !== category.id) {
        throw new HttpError(400, `A category named "${clash.name}" already exists`);
      }
      category.name = name;
      category.slug = slug;
    }
    if (req.body.description !== undefined) category.description = req.body.description;
    if (req.body.iconUrl !== undefined) category.iconUrl = req.body.iconUrl;
    if (req.body.sortOrder !== undefined) category.sortOrder = req.body.sortOrder;
    if (req.body.sizingGuide !== undefined) {
      category.attributeSchema = { ...(category.attributeSchema || {}), sizingGuide: req.body.sizingGuide };
    }

    await categories.save(category);

    const auditLogs = adminRepos.auditLogs();
    await auditLogs.save(auditLogs.create({
      action: 'category.update',
      resourceType: 'category',
      resourceId: category.id,
      details: `Updated category "${category.name}"`,
      status: 'success',
      ...actor(req),
    }));

    publishCategoryUpdate(category);
    adminCategoryCache.clear();
    sendSuccess(res, category);
  };

  toggle = async (req: Request, res: Response) => {
    const categories = adminRepos.categories();
    const category: any = await categories.findOne({ where: { id: routeParam(req.params.id) } });
    if (!category) throw new HttpError(404, 'Category not found');

    category.isActive = !category.isActive;
    await categories.save(category);
    publishCategoryUpdate(category);
    adminCategoryCache.clear();
    sendSuccess(res, { id: category.id, isActive: category.isActive });
  };

  remove = async (req: Request, res: Response) => {
    const categories = adminRepos.categories();
    const category: any = await categories.findOne({ where: { id: routeParam(req.params.id) } });
    if (!category) throw new HttpError(404, 'Category not found');

    const products = await adminRepos.products().find({ where: { categoryId: category.id } });
    if ((products as any[]).length > 0) {
      throw new HttpError(
        400,
        `"${category.name}" has ${(products as any[]).length} product(s). Deactivate it instead of deleting.`,
      );
    }

    category.deletedAt = new Date();
    await categories.save(category);

    // Strip the category from every staff member's assignment list
    const users = adminRepos.users();
    await User.updateMany(
      { assignedCategoryIds: category.id },
      { $pull: { assignedCategoryIds: category.id } },
    );

    const auditLogs = adminRepos.auditLogs();
    await auditLogs.save(auditLogs.create({
      action: 'category.delete',
      resourceType: 'category',
      resourceId: category.id,
      details: `Deleted empty category "${category.name}"`,
      status: 'success',
      ...actor(req),
    }));

    publishCategoryUpdate(category);
    adminCategoryCache.clear();
    sendSuccess(res, { id: category.id, deleted: true });
  };
}
