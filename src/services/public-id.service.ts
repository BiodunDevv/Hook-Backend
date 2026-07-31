import { PublicIdCounter } from '@models/platform/counter.model';
import { HttpError } from '@utils/http';

export const PUBLIC_ID_PREFIXES = {
  state: 'STA',
  city: 'CIT',
  zone: 'ZON',
  market: 'MAR',
  hub: 'HUB',
  partner: 'HPT',
  runner: 'RUN',
  customer: 'CUS',
  staff: 'STF',
  category: 'CAT',
  submission: 'SUB',
  product: 'PRD',
  variant: 'VAR',
  negotiation: 'NEG',
  quote: 'QTE',
  address: 'ADR',
  cart: 'CRT',
  cartItem: 'CTI',
  order: 'ORD',
  orderItem: 'ORI',
  payment: 'PAY',
  event: 'EVT',
  audit: 'AUD',
} as const;

export type PublicIdDomain = keyof typeof PUBLIC_ID_PREFIXES;

export function formatPublicId(prefix: string, year: number, sequence: number) {
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}

export async function nextPublicId(domain: PublicIdDomain, now = new Date()) {
  const prefix = PUBLIC_ID_PREFIXES[domain];
  const year = now.getUTCFullYear();
  const counter = await PublicIdCounter.findOneAndUpdate(
    { prefix, year },
    { $inc: { sequence: 1 }, $setOnInsert: { prefix, year } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
  if (!counter) throw new HttpError(500, 'Unable to generate public identifier', undefined, 'INTERNAL_ERROR');
  return formatPublicId(prefix, year, counter.sequence);
}

export async function repairPublicIdCounter(
  domain: PublicIdDomain,
  sequence: number,
  actorId: string,
  year = new Date().getUTCFullYear(),
) {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new HttpError(400, 'Counter sequence must be a non-negative integer');
  }
  const prefix = PUBLIC_ID_PREFIXES[domain];
  return PublicIdCounter.findOneAndUpdate(
    { prefix, year },
    { $set: { sequence, repairedAt: new Date(), repairedBy: actorId } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean({ virtuals: true });
}
