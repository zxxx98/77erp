export const permissionOptions = [
  { key: 'basic_view', label: '查看基础页面', description: '查看仪表盘、物料、库存、出入库记录、扫码查询和公告；业务操作仍需对应权限' },
  { key: 'ai', label: 'AI 助手', description: '使用 AI 查询及生成操作预览，执行仍需对应业务权限' },
  { key: 'products', label: '物料管理', description: '物料档案、校验、启停、删除、分类、图片及跨仓库同步' },
  { key: 'purchase', label: '入库', description: '入库开单、扫码入库、生产退料确认及成品入库审批' },
  { key: 'sale', label: '出库', description: '出库开单、扫码出库及生产领料确认' },
  { key: 'corrections', label: '单据纠正', description: '采购退货、销售退货及单据作废；生产作废需生产单权限，回退已入库批次还需入库权限' },
  { key: 'transfer', label: '仓库调拨', description: '仓库间库存调拨、撤销调拨及调拨记录' },
  { key: 'stocktake', label: '库存盘点', description: '盘点记录、提交盘点、库存调整、减少库存、增加库存（退料）及多仓库盘点 CSV 导出' },
  { key: 'business', label: '业务资料管理', description: '往来单位、自己的模板及出入库二维码配置' },
  { key: 'quality', label: '品质管理', description: '桌面验收模板配置、验收单解析与物料绑定、品质图表及原始 Excel 下载' },
  { key: 'bom', label: 'BOM', description: 'BOM 与工艺路线的维护、启停、备料测算、废料产出规则及导出' },
  { key: 'production', label: '生产管理', description: '查看全部生产单、派单、生产草稿、领料补料退料申请、分批登记及结束生产' },
  { key: 'production_register', label: '本组生产登记', description: '仅查看所属生产组的生产单并登记产量和耗料；未分组时没有可见生产单' },
  { key: 'finance', label: '财务管理', description: '收付款、欠款、库存成本及毛利报表' },
  { key: 'data_io', label: '数据导入导出', description: '物料批量导入及单据 CSV 导出' },
];
export const permissionKeys = permissionOptions.map(option => option.key);
export const legacyPermissions = ['products', 'purchase', 'sale', 'data_io'];
export function hasPermission(user, key) {
  return user?.role === 'admin' || ((!isProductionOnly(user) || key === 'production_register') && !!user?.permissions?.includes(key));
}
export function isProductionOnly(user) { return user?.role !== 'admin' && user?.access_mode === 'production_only'; }
export function canViewProduction(user) { return hasPermission(user, 'production') || hasPermission(user, 'production_register'); }
// Existing employees keep their former capabilities until an administrator saves a configuration.
export function canManage(user, key) {
  return hasPermission(user, key) && (!user?.legacy_permissions || user?.role === 'admin');
}
export function canManageTemplates(user) {
  return hasPermission(user, 'business') || !!user?.legacy_permissions;
}

// A standard position with only group registration uses the same isolated workspace.
export function usesProductionWorkspace(user) {
  return isProductionOnly(user) || (user?.role !== 'admin' && user?.permissions?.length === 1 && user.permissions[0] === 'production_register');
}
