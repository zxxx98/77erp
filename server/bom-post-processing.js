import { normalizePostMaterials } from './post-processing-materials.js';
import { processGraphWithPrices } from '../shared/process-routes.js';
import { validQuantity } from '../shared/quantity.js';
import { validateBomQuantity } from '../shared/bom.js';
import { postProcessingMaterialRate } from '../shared/post-processing.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const id = value => Number.isSafeInteger(value) && value > 0;

export function validateBomPostProcessing(operations) {
  if (!Array.isArray(operations) || operations.length > 50) fail('BOM 后处理工序最多 50 道。');
  const seen = new Set();
  for (const row of operations) {
    if (!row || !id(row.route_id) || !id(row.route_version) || typeof row.node_id !== 'string' || !row.node_id.trim() || row.node_id.length > 100 ||
        row.product_coefficient !== 1 || !(row.usage_basis === undefined || row.usage_basis === 'material') || !(row.price_table_id == null || typeof row.price_table_id === 'string' && row.price_table_id.length <= 100) ||
        !Array.isArray(row.materials) || row.materials.length > 100 ||
        row.materials.some(material => !id(material?.product_id) || !validQuantity(material.quantity, true)) ||
        new Set(row.materials.map(material => material.product_id)).size !== row.materials.length)
      fail('BOM 后处理工序或每单位成品材料用量无效，用量须为正数且最多 4 位小数。');
    const key = JSON.stringify([row.route_id, row.node_id]);
    if (seen.has(key)) fail('同一道后处理工序不能重复添加。');
    seen.add(key);
    if (row.usage_basis === 'material') for (const material of row.materials)
      validateBomQuantity(material.quantity, material.quantity_fraction ?? '');
  }
  return operations;
}

// Only material quantities are configurable here; identities come from the bound operation.
export function resolveBomPostProcessing(db, warehouseId, operations, productId, checkVersions = false) {
  return validateBomPostProcessing(operations).map(input => {
    const route = db.prepare('SELECT * FROM process_routes WHERE id=? AND warehouse_id=?').get(input.route_id, warehouseId);
    if (!route?.enabled || route.route_kind !== 'post_processing') fail('BOM 后处理工艺不存在或已停用，请重新配置。');
    if (checkVersions && route.version !== input.route_version) fail('后处理工艺已变化，请重新选择后保存。', 409);
    const graph = processGraphWithPrices(JSON.parse(route.graph), input.price_table_id);
    const node = graph.nodes.find(row => row.id === input.node_id);
    if (!node) fail('BOM 所选后处理工序不存在，请重新配置。');
    const bound = node.materials ?? [];
    if (bound.length !== input.materials.length || bound.some(row => !input.materials.some(material => material.product_id === row.product_id)))
      fail('后处理工序绑定材料已变化，请在 BOM 中重新选择工序并核对用量。', 409);
    const perRun = normalizePostMaterials(db, warehouseId, bound, true);
    const materials = input.usage_basis === 'material' ? perRun.map(row => {
      const usage = input.materials.find(material => material.product_id === row.product_id);
      return { ...row, quantity: usage.quantity, quantity_fraction: usage.quantity_fraction ?? '' };
    }) : normalizePostMaterials(db, warehouseId, bound.map(row => ({ product_id: row.product_id,
      quantity: input.materials.find(material => material.product_id === row.product_id).quantity })), true);
    if (input.usage_basis === 'material' && materials.length) postProcessingMaterialRate(materials, perRun);
    if (!checkVersions && input.materials.some(saved => {
      const current = materials.find(row => row.product_id === saved.product_id);
      return saved.unit !== undefined && (saved.unit !== current.unit || saved.unit_round_up !== current.unit_round_up);
    })) fail('BOM 后处理材料单位或取整规则已变化，请在 BOM 中核对用量后保存。', 409);
    if (materials.some(row => row.product_id === productId)) fail('成品不能作为自身的后处理材料。');
    return { route_id: route.id, route_version: route.version, node_id: node.id, name: node.name, route_name: route.name,
      price_table_id: input.price_table_id ?? null, price_table_name: graph.price_table_name ?? '',
      product_coefficient: 1, materials, ...(input.usage_basis === 'material' ? { usage_basis: 'material', materials_per_run: perRun } : {}) };
  });
}
