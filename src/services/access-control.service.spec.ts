import { describe, expect, it } from '@jest/globals';
import { ScopeType } from '@lib/constants';
import { assertPermission, assertScope, scopedFilter, AccessContext } from './access-control.service';

const context: AccessContext = {
  permissions: ['markets.view'],
  roleKeys: ['STATE_OPERATIONS_MANAGER'],
  scopeType: ScopeType.SINGLE_STATE,
  stateIds: ['state-lagos'],
  hubIds: [],
};

describe('platform access control', () => {
  it('allows an explicit permission inside assigned scope', () => {
    expect(() => assertPermission(context, 'markets.view')).not.toThrow();
    expect(() => assertScope(context, 'state-lagos')).not.toThrow();
  });

  it('denies permissions and states not assigned to the account', () => {
    expect(() => assertPermission(context, 'markets.manage')).toThrow('permission');
    expect(() => assertScope(context, 'state-ogun')).toThrow('outside your assigned scope');
  });

  it('applies scope to list queries', () => {
    expect(scopedFilter(context, { status: 'active' })).toEqual({
      status: 'active',
      stateId: { $in: ['state-lagos'] },
    });
  });

  it('allows super admins without duplicating every permission', () => {
    expect(() => assertPermission({ ...context, roleKeys: ['SUPER_ADMIN'] }, 'settings.manage')).not.toThrow();
  });
});
