import { Model } from 'mongoose';

type QueryOptions<T> = {
  where?: any | Array<any>;
  relations?: Record<string, any>;
  order?: Record<string, 'ASC' | 'DESC' | 1 | -1>;
  skip?: number;
  take?: number;
  select?: any;
};

type PopulateMap = Record<string, () => MongoRepository<any>>;

function normalizeFilter<T>(where?: any | Array<any>) {
  if (!where) return {};
  const normalizeOne = (input: any) => {
    const filter: Record<string, unknown> = { ...input };
    if ('id' in filter) {
      filter._id = filter.id;
      delete filter.id;
    }
    for (const [key, value] of Object.entries(filter)) {
      if (value && typeof value === 'object' && '$in' in (value as Record<string, unknown>)) continue;
      if (value && typeof value === 'object' && Array.isArray((value as any)._in)) {
        filter[key] = { $in: (value as any)._in };
      }
      if (value && typeof value === 'object' && (value as any)._between) {
        const [start, end] = (value as any)._between;
        filter[key] = { $gte: start, $lte: end };
      }
    }
    return filter;
  };
  if (Array.isArray(where)) return { $or: where.map((item) => normalizeOne(item)) };
  return normalizeOne(where);
}

function sortFrom(order?: Record<string, 'ASC' | 'DESC' | 1 | -1>): any {
  if (!order) return undefined;
  return Object.fromEntries(Object.entries(order).map(([key, value]) => [key, value === 'DESC' || value === -1 ? -1 : 1]));
}

function toPlain<T>(value: any): T {
  if (!value) return value;
  if (Array.isArray(value)) return value.map((item) => toPlain(item)) as T;
  const plain = typeof value.toObject === 'function' ? value.toObject({ virtuals: true }) : value;
  if (plain?._id) {
    plain.id = plain._id.toString();
    delete plain._id;
  }
  return plain;
}

function documentId(payload: any) {
  return payload?._id?.toString?.() || payload?.id;
}

function withoutDocumentId(payload: any) {
  const { id, _id, ...rest } = payload;
  return rest;
}

export class MongoRepository<T extends { id?: string }> {
  constructor(
    public readonly model: Model<T>,
    private readonly populateMap: PopulateMap = {},
  ) {}

  create(payload: Partial<T>) {
    return new this.model(payload);
  }

  async save(payload: any): Promise<any> {
    if (Array.isArray(payload)) {
      const saved = await Promise.all(payload.map((item) => this.save(item)));
      return saved;
    }
    if (payload?.save) {
      const doc = await payload.save();
      return toPlain<T>(doc);
    }
    const id = documentId(payload);
    if (id) {
      const doc = await this.model.findByIdAndUpdate(
        id,
        { $set: withoutDocumentId(payload) },
        { returnDocument: 'after', runValidators: true, upsert: false },
      );
      if (doc) return toPlain<T>(doc);
      const created = await this.model.create({ ...withoutDocumentId(payload), _id: id });
      return toPlain<T>(created);
    }
    const doc = await this.model.create(payload);
    return toPlain<T>(doc);
  }

  async findOne(options: QueryOptions<T>) {
    let query = this.model.findOne(normalizeFilter(options?.where));
    if (options?.select) query = query.select(options.select as any);
    if (options?.order) query = query.sort(sortFrom(options.order));
    const doc = await query.lean({ virtuals: true });
    return doc ? this.populate(toPlain<T>(doc), options?.relations) : null;
  }

  async find(options: QueryOptions<T> = {}) {
    let query = this.model.find(normalizeFilter(options.where));
    if (options.select) query = query.select(options.select as any);
    if (options.order) query = query.sort(sortFrom(options.order));
    if (options.skip) query = query.skip(options.skip);
    if (options.take) query = query.limit(options.take);
    const docs = await query.lean({ virtuals: true });
    return this.populateMany(toPlain<T[]>(docs), options.relations);
  }

  async findAndCount(options: QueryOptions<T> = {}) {
    const filter = normalizeFilter(options.where);
    let query = this.model.find(filter);
    if (options.order) query = query.sort(sortFrom(options.order));
    if (options.skip) query = query.skip(options.skip);
    if (options.take) query = query.limit(options.take);
    const [docs, total] = await Promise.all([
      query.lean({ virtuals: true }),
      this.model.countDocuments(filter),
    ]);
    return [await this.populateMany(toPlain<T[]>(docs), options.relations), total] as [T[], number];
  }

  async count(options: QueryOptions<T> = {}) {
    return this.model.countDocuments(normalizeFilter(options.where));
  }

  async update(criteria: string | any, payload: any) {
    const filter = typeof criteria === 'string' ? { _id: criteria } : normalizeFilter(criteria);
    return this.model.updateMany(filter, { $set: payload });
  }

  async delete(criteria: any) {
    return this.model.deleteMany(normalizeFilter(criteria));
  }

  async deleteMany(criteria: any = {}) {
    return this.model.deleteMany(normalizeFilter(criteria));
  }

  async aggregate<R = any>(pipeline: object[]) {
    const result = await (this.model as any).aggregate(pipeline);
    return toPlain<R[]>(result);
  }

  async populate(record: T, relations?: Record<string, any>) {
    if (!record || !relations) return record;
    const out: Record<string, unknown> = { ...record };
    await Promise.all(Object.entries(relations).filter(([, enabled]) => enabled).map(async ([relation]) => {
      const repoFactory = this.populateMap[relation];
      if (!repoFactory) return;
      const repo = repoFactory();
      const relatedId = (out as any)[`${relation}Id`];
      if (relatedId) out[relation] = await repo.findOne({ where: { id: relatedId } });
    }));
    return out as T;
  }

  async populateMany(records: T[], relations?: Record<string, any>) {
    return Promise.all(records.map((record) => this.populate(record, relations)));
  }
}

export const mongoIn = <T>(values: T[]) => ({ _in: values });
export const mongoBetween = (start: Date, end: Date) => ({ _between: [start, end] });
