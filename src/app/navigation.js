import { t as translate, getFormatLocale } from '../i18n/index.js';
import { LayoutDashboard, Box, ArrowDownToLine, ArrowUpFromLine, Warehouse, ScanLine, History, Megaphone, PackageCheck, Settings, ListTree, ClipboardList } from 'lucide-react';

export const navItems = [
  { id: 'overview', permission: 'basic_view', get name() { return translate("system.dashboard"); }, icon: LayoutDashboard, mode: 'warehouse', group: 'main', get mobile() { return translate("system.dashboard"); } },
  { id: 'products', permission: 'basic_view', get name() { return translate("system.materials"); }, icon: Box, mode: 'warehouse', group: 'main', get mobile() { return translate("system.material"); } },
  { id: 'purchases', permission: 'basic_view', get name() { return translate("system.stock.in"); }, icon: ArrowDownToLine, mode: 'warehouse', group: 'main' },
  { id: 'sales', permission: 'basic_view', get name() { return translate("system.stock.out"); }, icon: ArrowUpFromLine, mode: 'warehouse', group: 'main' },
  { id: 'inventory', permission: 'basic_view', get name() { return translate("system.inventory"); }, icon: Warehouse, mode: 'warehouse', group: 'main', get mobile() { return translate("system.stock"); } },
  { id: 'scanner', permission: 'basic_view', get name() { return translate("system.scanner"); }, icon: ScanLine, mode: 'warehouse', group: 'tools' },
  { id: 'history', permission: 'basic_view', get name() { return translate("system.activity.history"); }, icon: History, mode: 'warehouse', group: 'tools', get mobile() { return translate("system.document"); } },
  { id: 'quality', get name() { return translate("system.quality.management"); }, icon: PackageCheck, mode: 'production', group: 'main', get mobile() { return translate("system.quality"); }, permission: 'quality' },
  { id: 'bom', name: 'BOM', icon: ListTree, mode: 'production', group: 'main', mobile: 'BOM', permission: 'bom' },
  { id: 'production', get name() { return translate("system.production.orders"); }, icon: ClipboardList, mode: 'production', group: 'main', get mobile() { return translate("system.production.orders"); }, permission: 'production_view' },
  { id: 'announcements', permission: 'basic_view', get name() { return translate("system.announcements"); }, icon: Megaphone, group: 'tools' },
  { id: 'more', get name() { return translate("system.workspace"); }, icon: Settings, get mobile() { return translate("system.more"); } },
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
