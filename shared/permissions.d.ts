export type PermissionKey = 'products' | 'purchase' | 'sale' | 'corrections' | 'stocktake' | 'business' | 'finance' | 'data_io';
export type PermissionUser = { role?: string; permissions?: string[]; legacy_permissions?: boolean };
export const permissionOptions: { key: PermissionKey; label: string; description: string }[];
export const permissionKeys: PermissionKey[];
export const legacyPermissions: PermissionKey[];
export function hasPermission(user: PermissionUser | null | undefined, key: PermissionKey): boolean;
export function canManage(user: PermissionUser | null | undefined, key: PermissionKey): boolean;
export function canManageTemplates(user: PermissionUser | null | undefined): boolean;
