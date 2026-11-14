import { allocate } from './commerce.js';
import { validQuantity } from '../shared/quantity.js';
import { exactAdd, exactCompare, exactMultiply, exactQuantity, quantityFields, validExactQuantity } from '../shared/exact-quantity.js';
import { validateBomQuantity } from '../shared/bom.js';
import { postProcessingLimit, postProcessingMaterialRate } from '../shared/post-processing.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const productError = '请选择当前仓库已启用的后处理材料。';
const configError = '后处理材料不能重复，每次用量须为正数且最多 4 位小数。';
const quantityError = '后处理材料数量超出范围，请拆分生产单。';
const backupError = '备份后处理材料配置、用量或成本无效。';
const identity = ['name', 'barcode', 'specification', 'unit', 'unit_round_up'];
const isId = value => Number.isSafeInteger(value) && value > 0;
const validCost = value => Number.isSafeInteger(value) && value >= 0;

export function stripLegacyPostMaterials(value) {
  const graph = JSON.parse(value);
  if (!Array.isArray(graph?.nodes) || !graph.nodes.some(node => node && Object.hasOwn(node, 'materials'))) return value;
  for (const node of graph.nodes) if (node) delete node.materials;
  return JSON.stringify(graph);
}

function checkedMaterials(value, post, error) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100 || new Set(value.map(row => row?.product_id)).size !== value.length ||
      value.some(row => !isId(row?.product_id) || !validQuantity(row.quantity, true))) fail(error);
  if (!post && value.length) fail(error);
  return value;
}

export function normalizePostMaterials(db, warehouseId, value, post) {
  const materials = checkedMaterials(value, post, post ? configError : '仅后处理工序可以配置固定材料。');
  return materials.map(({ product_id, quantity }) => {
    const product = db.prepare('SELECT id AS product_id,name,barcode,specification,unit,unit_round_up,active FROM products WHERE id=? AND warehouse_id=?').get(product_id, warehouseId);
    if (!product?.active) fail(productError);
    if (product.unit_round_up && !Number.isInteger(quantity)) fail('后处理材料每次用量须符合整单位规则。');
    const { active, ...metadata } = product;
    return { ...metadata, quantity };
  });
}

export function planPostMaterials(graph, plannedQuantity, coefficient) {
  const post_processing_planned_runs = postProcessingLimit(plannedQuantity, coefficient, true, graph);
  return { post_processing_planned_runs, post_processing_materials: (graph.nodes[0].materials ?? []).map(material => {
    const planned_quantity = exactMultiply(material.quantity, post_processing_planned_runs);
    if (!validQuantity(planned_quantity, true)) fail(quantityError);
    return { ...material, planned_quantity };
  }) };
}

export function postMaterialPlanByProduct(routes) {
  const totals = new Map();
  for (const route of routes) for (const row of route.post_processing_materials ?? [])
    totals.set(row.product_id, exactAdd(totals.get(row.product_id) ?? 0, row.planned_quantity));
  return totals;
}

export function totalPlannedMaterials(item, postQuantity) {
  const total = exactAdd(item.planned_quantity, postQuantity);
  if (!validExactQuantity(total)) fail(quantityError);
  return { post_processing_planned_quantity: postQuantity, total_planned_quantity: total };
}

export function savePostMaterialItems(db, order, materials) {
  if (!materials.length) return;
  const items = new Map(db.prepare('SELECT product_id,unit,unit_round_up FROM production_items WHERE production_id=? ORDER BY position').all(order.id).map(row => [row.product_id, row]));
  let position = items.size;
  const insert = db.prepare(`INSERT INTO production_items(production_id,product_id,name,barcode,specification,unit,unit_round_up,base_quantity,base_quantity_fraction,loss_rate,planned_quantity,note,position)
    VALUES (?,?,?,?,?,?,?,0,'',0,0,'',?)`);
  for (const material of materials) {
    const existing = items.get(material.product_id);
    if (existing) {
      if (material.unit !== existing.unit || material.unit_round_up !== existing.unit_round_up)
        fail('生产物料已停用、单位或取整规则已变化，请先核对。', 409);
      continue;
    }
    if (position >= 500) fail('生产单材料最多 500 种，请拆分生产单。');
    insert.run(order.id, material.product_id, ...identity.map(key => material[key]), position++);
    items.set(material.product_id, material);
  }
}

export function consumePostMaterials(db, order, node, runs, validateOnly = false) {
  return (node.materials ?? []).map(material => {
    const { product_id } = material;
    const product = db.prepare('SELECT active,unit,unit_round_up FROM products WHERE id=? AND warehouse_id=?').get(product_id, order.warehouse_id);
    if (!product?.active || product.unit !== material.unit || product.unit_round_up !== material.unit_round_up)
      fail('生产物料已停用、单位或取整规则已变化，请先核对。', 409);
    const quantity = exactMultiply(material.quantity, runs);
    if (!validQuantity(quantity, true)) fail(quantityError);
    const item = order.items.find(row => row.product_id === product_id);
    const available = exactQuantity(item, 'available_quantity');
    if (validateOnly) return { product_id, quantity };
    if (exactCompare(quantity, available) > 0) fail(`${material.name}已领未耗余额不足（当前 ${available} ${material.unit}）。请补料或核对实际耗料。`, 409);
    const basis_cost_cents = item.available_cost_cents;
    return { product_id, quantity, ...quantityFields(available, 'basis_quantity'), basis_cost_cents,
      cost_cents: allocate(basis_cost_cents, quantity, available) };
  });
}

function parseReportMaterials(raw) {
  let rows;
  try { if (typeof raw === 'string') rows = JSON.parse(raw); }
  catch { fail(backupError); }
  if (!Array.isArray(rows)) fail(backupError);
  return rows;
}

export function readPostMaterialReport(report, graph, post) {
  const { post_materials, ...row } = report;
  if (!post) return row;
  const materials = graph.nodes[0].materials ?? [];
  const post_processing_materials = parseReportMaterials(post_materials).map((entry, index) => ({
    ...materials[index], quantity: entry.quantity, cost_cents: entry.cost_cents,
  }));
  return { ...row, post_processing_materials, post_processing_material_cost_cents: sumPostMaterialCosts(post_processing_materials) };
}

export function sumPostMaterialCosts(rows) {
  const total = rows.reduce((sum, row) => sum + row.cost_cents, 0);
  if (!validCost(total)) fail('生产材料成本超出范围。');
  return total;
}

// Balance and rounding validation need the active records, including reports outside the UI page.
export function postMaterialUsage(reports) {
  const totals = new Map();
  for (const report of reports) if (report.status === 'active') for (const row of parseReportMaterials(report.post_materials)) {
    const current = totals.get(row.product_id) ?? { quantity: 0, cost_cents: 0 };
    const quantity = exactAdd(current.quantity, row.quantity);
    const cost_cents = sumPostMaterialCosts([current, row]);
    totals.set(row.product_id, { quantity, cost_cents });
  }
  return totals;
}

export function validatePostMaterialGraph(graph, post, products, warehouseId, items) {
  validatePostMaterialBasis(graph, post, products, warehouseId);
  for (const node of graph.nodes) for (const row of checkedMaterials(node.materials, post, backupError)) {
    if (Object.keys(row).length !== 7 || products.get(row.product_id)?.warehouse_id !== warehouseId ||
        ![0,1].includes(row.unit_round_up) || row.unit_round_up && !Number.isInteger(row.quantity) ||
        ['name', 'barcode', 'specification', 'unit'].some(key => typeof row[key] !== 'string' ||
          row[key].length > (key === 'specification' ? 500 : 100) || key !== 'specification' && !row[key].trim()))
      fail(backupError);
    if (items) {
      const item = items.get(row.product_id);
      if (!item || item.unit !== row.unit || item.unit_round_up !== row.unit_round_up ||
          item.base_quantity === 0 && identity.some(key => item[key] !== row[key])) fail(backupError);
    }
  }
}

export function validatePostMaterialBasis(graph, post, products, warehouseId) {
  const basis = graph.post_processing_materials_per_unit;
  if (basis === undefined) return;
  const fixed = graph.nodes[0].materials ?? [];
  if (!post || !Array.isArray(basis) || !basis.length || basis.length !== fixed.length ||
      new Set(basis.map(row => row?.product_id)).size !== basis.length) fail(backupError);
  for (const row of basis) {
    const material = fixed.find(material => material.product_id === row?.product_id);
    if (!material || Object.keys(row).length !== 8 || typeof row.quantity_fraction !== 'string' ||
        identity.some(key => row[key] !== material[key]) || products.get(row.product_id)?.warehouse_id !== warehouseId) fail(backupError);
    validateBomQuantity(row.quantity, row.quantity_fraction);
  }
  postProcessingMaterialRate(basis, fixed);
}

export function validatePostMaterialReport(report, node, post) {
  const rows = parseReportMaterials(report.post_materials);
  const config = post ? node.materials ?? [] : [];
  if (rows.length !== config.length) fail(backupError);
  rows.forEach((row, index) => {
    const material = config[index];
    if (!row || Object.keys(row).length !== 6 || row.product_id !== material.product_id ||
        !validQuantity(row.quantity, true) || row.quantity !== exactMultiply(report.quantity, material.quantity) ||
        !validCost(row.cost_cents) || !validCost(row.basis_cost_cents) || typeof row.basis_quantity_fraction !== 'string' ||
        typeof row.basis_quantity !== 'number') fail(backupError);
    const basis = exactQuantity(row, 'basis_quantity');
    if (!validExactQuantity(basis, true) || quantityFields(basis).quantity !== row.basis_quantity ||
        exactCompare(row.quantity, basis) > 0 || allocate(row.basis_cost_cents, row.quantity, basis) !== row.cost_cents)
      fail(backupError);
  });
  sumPostMaterialCosts(rows);
}
