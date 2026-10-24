export const notificationEvents = [
  { key: 'database_backup', label: '数据库备份', description: 'R2 备份成功或失败后通知，不受仓库筛选限制。' },
  { key: 'low_stock', label: '低库存预警', description: '库存从正常变为偏低时通知。' },
  { key: 'out_of_stock', label: '缺货提醒', description: '库存从有货变为零时通知。' },
  { key: 'stock_recovered', label: '库存恢复', description: '低库存或缺货恢复到安全库存以上时通知。' },
  { key: 'purchase_in', label: '入库', description: '普通入库单提交成功后通知，包含二维码开单。' },
  { key: 'sale_out', label: '出库', description: '普通出库单提交成功后通知，包含二维码开单。' },
  { key: 'order_return', label: '采购／销售退货', description: '退货成功后通知，附原单号和原因。' },
  { key: 'order_void', label: '单据作废', description: '单据作废成功后通知。' },
  { key: 'transfer', label: '仓库调拨', description: '仓库间调拨成功或撤销后通知，包含调出与调入仓库。' },
  { key: 'stock_adjustment', label: '盘点差异／报损', description: '盘点有实际差异或减少库存成功后通知。' },
  { key: 'payment', label: '收付款变动', description: '登记、撤销收付款或历史收付核对后通知，包含结清状态。' },
  { key: 'daily_summary', label: '每日经营汇总', description: '定时汇总当日采购、销售、退货和当前库存预警数量。' },
  { key: 'admin_action', label: '关键管理操作', description: '业务恢复、重置或账号角色、状态、权限变更后通知。' },
];
export const notificationFormats = [
  { key: 'json', label: '通用 Webhook（JSON）' },
  { key: 'wecom', label: '企业微信群机器人' },
  { key: 'dingtalk', label: '钉钉群机器人' },
  { key: 'feishu', label: '飞书群机器人' },
];
export const notificationStatuses = { pending: '待发送', sending: '发送中', retry: '等待重试', sent: '已发送', failed: '发送失败', cancelled: '已取消' };
