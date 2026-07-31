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
  orders: ['view', 'create', 'edit'],
  products: ['view', 'review', 'edit'],
  'catalog.submission': ['view', 'review', 'request_changes', 'approve', 'reject'],
  'catalog.product': ['view', 'edit', 'publish', 'pause', 'unpublish'],
  'catalog.pricing': ['view_internal', 'edit'],
  'catalog.negotiation_rules': ['view_internal', 'edit'],
  'catalog.media': ['upload', 'review'],
  customers: ['view', 'edit'],
  financials: ['view', 'refund', 'reconcile'],
  refunds: ['view', 'manage'],
  deletions: ['view', 'manage'],
  analytics: ['checkout'],
  reports: ['view'],
  ai_negotiation: ['view'],
  settings: ['view', 'manage'],
  audit: ['view'],
  'commerce.pod': ['review', 'override', 'eligibility'],
  'commerce.payments': ['view', 'reconcile'],
  'commerce.outbox': ['view'],
  'commerce.settings': ['view', 'manage'],
};

export const PLATFORM_PERMISSION_KEYS = Object.entries(domains)
  .flatMap(([domain, actions]) => actions.map((action) => `${domain}.${action}`));

const readPermissions = PLATFORM_PERMISSION_KEYS.filter((key) => key.endsWith('.view'));
const operationsPermissions = PLATFORM_PERMISSION_KEYS.filter((key) =>
  /^(states|cities|zones|markets|hubs|runners|partners|audit)\./.test(key),
);
const orderRead = ['orders.view', 'customers.view', 'reports.view'];
const orderOperations = [...orderRead, 'orders.create', 'orders.edit'];
const commerceOperations = ['commerce.pod.review', 'commerce.pod.eligibility', 'commerce.outbox.view'];
const catalogRead = [
  'products.view',
  'markets.view',
  'catalog.submission.view',
  'catalog.product.view',
];
const commercialManage = [
  ...catalogRead,
  'catalog.product.edit',
  'catalog.product.publish',
  'catalog.product.pause',
  'catalog.product.unpublish',
  'catalog.pricing.view_internal',
  'catalog.pricing.edit',
  'catalog.negotiation_rules.view_internal',
  'catalog.negotiation_rules.edit',
  'catalog.media.review',
  'ai_negotiation.view',
];
const supportPermissions = [
  ...orderRead,
  'customers.edit',
  'refunds.view',
  'deletions.view',
  'deletions.manage',
  'commerce.pod.review',
  'commerce.pod.eligibility',
];
const financePermissions = [
  'orders.view',
  'financials.view',
  'financials.refund',
  'financials.reconcile',
  'refunds.view',
  'refunds.manage',
  'reports.view',
  'audit.view',
  'commerce.payments.view',
  'commerce.payments.reconcile',
  'commerce.outbox.view',
];

const roles = [
  { key: 'SUPER_ADMIN', name: 'Super Admin', scope: ScopeType.GLOBAL, permissions: PLATFORM_PERMISSION_KEYS },
  { key: 'OPERATIONS_LEAD', name: 'Operations Lead', scope: ScopeType.MULTI_STATE, permissions: [...operationsPermissions, ...orderOperations, ...commerceOperations, 'staff.view'] },
  { key: 'STATE_OPERATIONS_MANAGER', name: 'State Operations Manager', scope: ScopeType.SINGLE_STATE, permissions: [...operationsPermissions, ...orderOperations, ...commerceOperations] },
  {
    key: 'COMMERCIAL_MANAGER',
    name: 'Commercial Manager',
    scope: ScopeType.MULTI_STATE,
    permissions: [...commercialManage, 'products.review', 'products.edit', 'audit.view'],
  },
  {
    key: 'COMMERCIAL_OFFICER',
    name: 'Commercial Officer',
    scope: ScopeType.SINGLE_STATE,
    permissions: [...catalogRead, 'catalog.product.edit', 'catalog.pricing.view_internal', 'catalog.pricing.edit'],
  },
  {
    key: 'CATALOG_REVIEWER',
    name: 'Catalog Reviewer',
    scope: ScopeType.MULTI_STATE,
    permissions: [
      ...catalogRead,
      'catalog.submission.review',
      'catalog.submission.request_changes',
      'catalog.submission.approve',
      'catalog.submission.reject',
      'products.review',
      'catalog.media.review',
    ],
  },
  { key: 'DISPATCH_HUB_MANAGER', name: 'Dispatch Hub Manager', scope: ScopeType.HUB, permissions: ['hubs.view', 'markets.view', 'runners.view', 'runners.assign', ...orderOperations] },
  { key: 'DISPATCH_HUB_OFFICER', name: 'Dispatch Hub Officer', scope: ScopeType.HUB, permissions: ['hubs.view', 'markets.view', 'runners.view', 'orders.view', 'orders.edit'] },
  { key: 'LOGISTICS_OFFICER', name: 'Logistics Officer', scope: ScopeType.MULTI_STATE, permissions: ['hubs.view', 'markets.view', 'runners.view', 'orders.view', 'orders.edit'] },
  { key: 'CUSTOMER_SUPPORT_OFFICER', name: 'Customer Support Officer', scope: ScopeType.MULTI_STATE, permissions: supportPermissions },
  { key: 'FINANCE_OFFICER', name: 'Finance Officer', scope: ScopeType.MULTI_STATE, permissions: financePermissions },
  { key: 'MANAGEMENT_VIEWER', name: 'Management Viewer', scope: ScopeType.GLOBAL, permissions: [...readPermissions, 'analytics.checkout'] },
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
        $set: {
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
