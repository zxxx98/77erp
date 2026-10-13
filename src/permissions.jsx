import { createContext, useContext } from 'react';
import { hasPermission, canManage, canManageTemplates } from '../shared/permissions.js';
export const PermissionContext = createContext({ role: 'admin' });
export function usePermissions() {
  const user = useContext(PermissionContext);
  return { user, can: key => hasPermission(user, key), manage: key => canManage(user, key),
    templates: canManageTemplates(user), costs: hasPermission(user, 'finance') || !!user?.legacy_permissions };
}
