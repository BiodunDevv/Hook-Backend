import { describe, expect, it } from '@jest/globals';
import { formatPublicId, PUBLIC_ID_PREFIXES } from './public-id.service';

describe('public Hook IDs', () => {
  it('formats a stable annual identifier', () => {
    expect(formatPublicId(PUBLIC_ID_PREFIXES.runner, 2026, 42)).toBe('RUN-2026-000042');
  });

  it('uses distinct approved prefixes for every public domain', () => {
    expect(new Set(Object.values(PUBLIC_ID_PREFIXES)).size).toBe(Object.keys(PUBLIC_ID_PREFIXES).length);
  });
});
