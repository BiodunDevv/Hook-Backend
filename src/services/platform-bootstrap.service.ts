import { ScopeType } from '@lib/constants';
import { Permission, Role } from '@models/platform/access.model';

const domains: Record<string, string[]> = {
  staff: ['view', 'create', 'edit', 'suspend', 'revoke_sessions'],
  roles: ['view', 'manage'],
  states: ['view', 'manage'],
  cities: ['view', 'manage'],
  zones: ['view', 'manage'],
  markets: ['view', 'manage', 'assign_hub'],
  hubs: ['view', 'manage', 'assign_markets'],
  partners: ['view', 'manage'],
  runners: ['view', 'manage', 'assign'],
  settings: ['view', 'manage'],
  audit: ['view'],
};

export const PLATFORM_PERMISSION_KEYS = Object.entries(domains)
  .flatMap(([domain, actions]) => actions.map((action) => `${domain}.${action}`));

const readPermissions = PLATFORM_PERMISSION_KEYS.filter((key) => key.endsWith('.view'));
const operationsPermissions = PLATFORM_PERMISSION_KEYS.filter((key) =>
  /^(states|cities|zones|markets|hubs|runners|partners|audit)\./.test(key),
);

const roles = [
  { key: 'SUPER_ADMIN', name: 'Super Admin', scope: ScopeType.GLOBAL, permissions: PLATFORM_PERMISSION_KEYS },
  { key: 'OPERATIONS_LEAD', name: 'Operations Lead', scope: ScopeType.MULTI_STATE, permissions: [...operationsPermissions, 'staff.view'] },
  { key: 'STATE_OPERATIONS_MANAGER', name: 'State Operations Manager', scope: ScopeType.SINGLE_STATE, permissions: operationsPermissions },
  { key: 'COMMERCIAL_MANAGER', name: 'Commercial Manager', scope: ScopeType.MULTI_STATE, permissions: ['markets.view', 'partners.view', 'partners.manage', 'audit.view'] },
  { key: 'COMMERCIAL_OFFICER', name: 'Commercial Officer', scope: ScopeType.SINGLE_STATE, permissions: ['markets.view', 'partners.view'] },
  { key: 'CATALOG_REVIEWER', name: 'Catalog Reviewer', scope: ScopeType.MULTI_STATE, permissions: ['markets.view'] },
  { key: 'DISPATCH_HUB_MANAGER', name: 'Dispatch Hub Manager', scope: ScopeType.HUB, permissions: ['hubs.view', 'markets.view', 'runners.view', 'runners.assign'] },
  { key: 'DISPATCH_HUB_OFFICER', name: 'Dispatch Hub Officer', scope: ScopeType.HUB, permissions: ['hubs.view', 'markets.view', 'runners.view'] },
  { key: 'LOGISTICS_OFFICER', name: 'Logistics Officer', scope: ScopeType.MULTI_STATE, permissions: ['hubs.view', 'markets.view', 'runners.view'] },
  { key: 'CUSTOMER_SUPPORT_OFFICER', name: 'Customer Support Officer', scope: ScopeType.MULTI_STATE, permissions: readPermissions },
  { key: 'FINANCE_OFFICER', name: 'Finance Officer', scope: ScopeType.MULTI_STATE, permissions: readPermissions },
  { key: 'MANAGEMENT_VIEWER', name: 'Management Viewer', scope: ScopeType.GLOBAL, permissions: readPermissions },
];

export async function ensurePlatformAccessCatalog() {
  await Permission.bulkWrite(PLATFORM_PERMISSION_KEYS.map((key) => {
    const [domain, action] = key.split('.');
    return {
      updateOne: {
        filter: { key },
        update: { $setOnInsert: { key, domain, description: `${action.replaceAll('_', ' ')} ${domain}`, isActive: true } },
        upsert: true,
      },
    };
  }));
  await Role.bulkWrite(roles.map((role) => ({
    updateOne: {
      filter: { key: role.key },
      update: {
        $setOnInsert: {
          key: role.key,
          name: role.name,
          description: `${role.name} platform role`,
          permissionKeys: role.permissions,
          defaultScopeType: role.scope,
          isSystem: true,
          isActive: true,
        },
      },
      upsert: true,
    },
  })));
}
