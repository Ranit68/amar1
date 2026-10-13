export const PERMISSIONS = [
  "dashboard.view",
  "reports.view",
  "products.write",
  "inventory.write",
  "suppliers.write",
  "purchases.post",
  "hawkers.write",
  "sales.post",
  "payments.post",
  "expenses.post",
  "scanner.use",
  "closing.post",
  "analytics.view",
  "alerts.manage",
  "audit.view",
  "settings.manage",
  "users.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_DEFAULT_PERMISSIONS: Record<string, Permission[]> = {
  owner: [...PERMISSIONS],
  manager: [
    "dashboard.view",
    "reports.view",
    "products.write",
    "inventory.write",
    "suppliers.write",
    "purchases.post",
    "hawkers.write",
    "sales.post",
    "payments.post",
    "expenses.post",
    "scanner.use",
    "closing.post",
    "analytics.view",
    "alerts.manage",
    "audit.view",
  ],
  staff: [],
};

export type Role = keyof typeof ROLE_DEFAULT_PERMISSIONS;

export function permissionsFor(
  role: string | null | undefined,
  memberPermissions: string[] = [],
): Permission[] {
  const defaults = ROLE_DEFAULT_PERMISSIONS[role ?? "staff"] ?? [];
  return Array.from(new Set([...defaults, ...(memberPermissions as Permission[])]));
}

export function can(perms: Permission[], permission: Permission): boolean {
  return perms.includes(permission);
}
