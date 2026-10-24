import { LayoutDashboard, Box, ArrowDownToLine, ArrowUpFromLine, Warehouse, ScanLine, History, Megaphone, PackageCheck, Settings, ListTree, ClipboardList } from 'lucide-react';

export const navItems = [
  { id: 'overview', name: '工作台', icon: LayoutDashboard, mode: 'warehouse', group: 'main', mobile: '工作台' },
  { id: 'products', name: '物料管理', icon: Box, mode: 'warehouse', group: 'main', mobile: '物料' },
  { id: 'purchases', name: '入库', icon: ArrowDownToLine, mode: 'warehouse', group: 'main' },
  { id: 'sales', name: '出库', icon: ArrowUpFromLine, mode: 'warehouse', group: 'main' },
  { id: 'inventory', name: '库存管理', icon: Warehouse, mode: 'warehouse', group: 'main', mobile: '库存' },
  { id: 'scanner', name: '扫码工作台', icon: ScanLine, mode: 'warehouse', group: 'tools' },
  { id: 'history', name: '操作记录', icon: History, mode: 'warehouse', group: 'tools', mobile: '单据' },
  { id: 'quality', name: '品质管理', icon: PackageCheck, mode: 'production', group: 'main', mobile: '品质', permission: 'quality' },
  { id: 'bom', name: 'BOM', icon: ListTree, mode: 'production', group: 'main', mobile: 'BOM', permission: 'bom' },
  { id: 'production', name: '生产单', icon: ClipboardList, mode: 'production', group: 'main', mobile: '生产单', permission: 'production_view' },
  { id: 'announcements', name: '公告中心', icon: Megaphone, group: 'tools' },
  { id: 'more', name: '工作空间', icon: Settings, mobile: '更多' },
];
export const modeHome = mode => mode === 'production' ? 'quality' : 'overview';
export function routeMode(id, hash, fallback) {
  return navItems.find(item => item.id === id)?.mode || (new URLSearchParams(hash.split('?')[1]).get('mode') === 'production' ? 'production' : new URLSearchParams(hash.split('?')[1]).get('mode') === 'warehouse' ? 'warehouse' : fallback);
}
export function navigationHash(id, mode) {
  return `#${id}${navItems.find(item => item.id === id)?.mode ? '' : `?mode=${mode}`}`;
}
export function modeItems(mode, can) {
  return navItems.filter(item => (!item.mode || item.mode === mode) && (!item.permission || can(item.permission)));
}
