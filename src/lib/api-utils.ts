import { Request } from 'express';
import { PAGINATION_DEFAULTS } from './constants';

export interface PageOptions {
  page: number;
  limit: number;
  skip: number;
}

export function getPagination(query: Request['query']): PageOptions {
  const page = Math.max(Number(query.page || PAGINATION_DEFAULTS.PAGE), 1);
  const limit = Math.min(
    Math.max(Number(query.limit || PAGINATION_DEFAULTS.LIMIT), 1),
    PAGINATION_DEFAULTS.MAX_LIMIT,
  );

  return { page, limit, skip: (page - 1) * limit };
}

export function paginated<T>(data: T[], total: number, page: number, limit: number) {
  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value || '';
}

export function initials(firstName?: string, lastName?: string, fallback?: string) {
  const first = firstName?.charAt(0) || '';
  const last = lastName?.charAt(0) || '';
  const value = `${first}${last}`.trim();
  return value || fallback?.slice(0, 2).toUpperCase() || 'HK';
}

export function money(value: number, currency = 'NGN') {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value || 0);
}
