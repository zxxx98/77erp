import { createContext, useContext } from 'react';
import { PermissionUser, hasPermission, canManage, canManageTemplates } from '../../shared/permissions';
export const PermissionContext = createContext<PermissionUser>({ role: 'admin' });
export function usePermissions() {
  const user = useContext(PermissionContext);
  return { user, can: (key: Parameters<typeof hasPermission>[1]) => hasPermission(user, key),
    manage: (key: Parameters<typeof canManage>[1]) => canManage(user, key),
    templates: canManageTemplates(user), costs: hasPermission(user, 'finance') || !!user.legacy_permissions };
}
