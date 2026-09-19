import assert from 'node:assert/strict';
import { test } from 'node:test';
import { itemVerifySchema } from '../src/validations/fulfilment.schemas';
import { decryptPackageCredential, encryptPackageCredential } from '../src/lib/package-credential-crypto';
import { RunnerPackage } from '../src/models/fulfilment/fulfilment.model';

const completeItem = {
  photos: [
    { view: 'front', url: 'https://images.example/front.jpg' },
    { view: 'side', url: 'https://images.example/side.jpg' },
    { view: 'back', url: 'https://images.example/back.jpg' },
  ],
  actualColor: 'Black', actualSize: '42', actualQuantity: 2, unitCostMinor: 30000,
  supplierReference: 'STALL-17', conditionNote: 'New and inspected',
  checks: { productMatches: true, sizeMatches: true, colorMatches: true, quantityMatches: true },
};

test('item fulfilment requires exactly one front, side and back photo', () => {
  assert.equal(itemVerifySchema.safeParse(completeItem).success, true);
  const duplicateFront = { ...completeItem, photos: [completeItem.photos[0], completeItem.photos[0], completeItem.photos[2]] };
  assert.equal(itemVerifySchema.safeParse(duplicateFront).success, false);
});

test('Hub handover credential can be redisplayed from encrypted storage without storing plaintext', () => {
  process.env.PACKAGE_CREDENTIAL_ENCRYPTION_KEY = 'test-package-key';
  const encrypted = encryptPackageCredential('4821');
  assert.notEqual(encrypted, '4821');
  assert.equal(decryptPackageCredential(encrypted), '4821');
});

test('active Hub handover codes are unique within a Hub', () => {
  const index = RunnerPackage.schema.indexes().find(([fields, options]) => fields.hubId === 1 && fields.scanCredentialHash === 1 && options.unique);
  assert.ok(index);
  assert.deepEqual(index?.[1].partialFilterExpression, { status: 'READY_FOR_HUB' });
});
