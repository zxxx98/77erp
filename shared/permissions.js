export const permissionOptions = [
  { key: 'products', label: '商品管理', description: '商品档案、上下架、删除、分类、图片及跨仓库同步' },
  { key: 'purchase', label: '采购入库', description: '采购开单及扫码入库' },
  { key: 'sale', label: '销售出库', description: '销售开单及扫码出库' },
  { key: 'corrections', label: '单据纠正', description: '采购退货、销售退货及单据作废' },
  { key: 'stocktake', label: '库存盘点', description: '盘点记录、提交盘点及库存调整' },
  { key: 'business', label: '业务资料管理', description: '供应商与客户、自己的模板及出入库二维码配置' },
  { key: 'finance', label: '财务管理', description: '收付款、欠款、库存成本及毛利报表' },
  { key: 'data_io', label: '数据导入导出', description: '商品批量导入及单据 CSV 导出' },
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
