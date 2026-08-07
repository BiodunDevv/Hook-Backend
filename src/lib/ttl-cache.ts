type Entry<T> = { value: T; expiresAt: number };

export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(private readonly defaultTtlMs: number) {}

  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.defaultTtlMs) {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  clear() {
    this.entries.clear();
  }

  clearWhere(predicate: (key: string) => boolean) {
    for (const key of this.entries.keys()) {
      if (predicate(key)) this.entries.delete(key);
    }
  }
}

export const publicCatalogCache = new TtlCache<any>(20_000);
export const adminDashboardCache = new TtlCache<any>(10_000);
export const adminFinancialCache = new TtlCache<any>(10_000);
export const adminCatalogCache = new TtlCache<any>(10_000);
export const adminProductStatsCache = new TtlCache<any>(10_000);
export const adminOrderStatsCache = new TtlCache<any>(10_000);
export const adminCategoryManagersCache = new TtlCache<Map<string, any[]>>(30_000);
export const adminCategoryCache = new TtlCache<any>(10_000);
export const adminReviewCache = new TtlCache<any>(10_000);
export const adminOperationsCache = new TtlCache<any>(10_000);
export const adminStaffCache = new TtlCache<any>(10_000);
export const adminAccessCatalogCache = new TtlCache<any>(60_000);
export const adminDeliveryCache = new TtlCache<any>(10_000);
export const platformReferenceCache = new TtlCache<Map<string, string>>(30_000);
