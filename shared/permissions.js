export const permissionOptions = [
  { key: 'ai', label: 'AI 助手', description: '使用 AI 查询及生成操作预览，执行仍需对应业务权限' },
  { key: 'products', label: '物料管理', description: '物料档案、启停、删除、分类、图片及跨仓库同步' },
  { key: 'purchase', label: '采购入库', description: '采购开单及扫码入库' },
  { key: 'sale', label: '销售出库', description: '销售开单及扫码出库' },
  { key: 'corrections', label: '单据纠正', description: '采购退货、销售退货及单据作废' },
  { key: 'transfer', label: '仓库调拨', description: '仓库间库存调拨、撤销调拨及调拨记录' },
  { key: 'stocktake', label: '库存盘点', description: '盘点记录、提交盘点、库存调整、减少库存、增加库存（退料）及多仓库盘点 CSV 导出' },
  { key: 'business', label: '业务资料管理', description: '供应商与客户、自己的模板及出入库二维码配置' },
  { key: 'finance', label: '财务管理', description: '收付款、欠款、库存成本及毛利报表' },
  { key: 'data_io', label: '数据导入导出', description: '物料批量导入及单据 CSV 导出' },
];
export const permissionKeys = permissionOptions.map(option => option.key);
export const legacyPermissions = ['products', 'purchase', 'sale', 'data_io'];
export function hasPermission(user, key) {
  return user?.role === 'admin' || !!user?.permissions?.includes(key);
}
// Existing employees keep their former capabilities until an administrator saves a configuration.
export function canManage(user, key) {
  return hasPermission(user, key) && (!user?.legacy_permissions || user?.role === 'admin');
}
export function canManageTemplates(user) {
  return hasPermission(user, 'business') || !!user?.legacy_permissions;
}
