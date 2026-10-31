export type PermissionKey = 'operation_accept' | 'basic_view' | 'production_register' | 'ai' | 'products' | 'purchase' | 'sale' | 'corrections' | 'transfer' | 'stocktake' | 'business' | 'quality' | 'bom' | 'production' | 'finance' | 'data_io';
export type PermissionUser = { role?: string; permissions?: string[]; legacy_permissions?: boolean; standard_permissions?: string[]; access_mode?: string };
export const permissionOptions: { key: PermissionKey; label: string; description: string }[];
export const permissionKeys: PermissionKey[];
export const legacyPermissions: PermissionKey[];
export function hasPermission(user: PermissionUser | null | undefined, key: PermissionKey): boolean;
export function canManage(user: PermissionUser | null | undefined, key: PermissionKey): boolean;
export function canManageTemplates(user: PermissionUser | null | undefined): boolean;
export function combinePositionAuthorization(positions: { permissions: string[]; legacy_permissions?: boolean; access_mode?: string }[]): { permissions: PermissionKey[]; standard_permissions: PermissionKey[]; legacy_permissions: boolean; access_mode: string };
