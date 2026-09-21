import assert from 'node:assert/strict';
import { test } from 'node:test';
import { podConfigSchema } from '../src/validations/commerce.schemas';

test('a Pay on Delivery change needs a reason and only known fields', () => {
  assert.throws(() => podConfigSchema.parse({ podEnabled: true }));
  assert.throws(() => podConfigSchema.parse({ podEnabled: true, reason: 'ok', mystery: 1 }));
  const parsed = podConfigSchema.parse({ podEnabled: true, podMinimumOrderMinor: 3_000_000, vatRatePercent: 7.5, reason: 'Launch in Lagos' });
  assert.equal(parsed.podMinimumOrderMinor, 3_000_000);
});

test('a percentage surcharge cannot exceed 50 percent and VAT stays sensible', () => {
  assert.throws(() => podConfigSchema.parse({ podSurchargeType: 'percent', podSurchargeValue: 60, reason: 'too much' }));
  assert.doesNotThrow(() => podConfigSchema.parse({ podSurchargeType: 'percent', podSurchargeValue: 5, reason: 'small fee' }));
  assert.throws(() => podConfigSchema.parse({ vatRatePercent: 45, reason: 'invalid vat' }));
  assert.throws(() => podConfigSchema.parse({ podRefusalSuspendCount: 0, reason: 'invalid count' }));
});
