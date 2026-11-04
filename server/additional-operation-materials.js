import { allocate } from './commerce.js';
import { validQuantity, materialQuantity } from '../shared/quantity.js';
import { exactQuantity, exactCompare, parseExactQuantity, quantityFields } from '../shared/exact-quantity.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const isId = value => Number.isSafeInteger(value) && value > 0;

export function captureAdditionalMaterials(db, order, materials = []) {
  if (!Array.isArray(materials) || materials.length > 100 || new Set(materials.map(row => row?.product_id)).size !== materials.length)
    fail('请核对附加工序材料明细，材料不能重复且最多 100 种。');
  return materials.map(row => {
    if (!isId(row?.product_id) || !validQuantity(row.quantity, true)) fail('附加工序计划用料需为正数，最多 4 位小数。');
    const product = db.prepare('SELECT * FROM products WHERE id=? AND warehouse_id=?').get(row.product_id, order.warehouse_id);
    if (!product?.active) fail('附加工序材料需属于当前仓库且已启用。');
    let item = db.prepare('SELECT * FROM production_items WHERE production_id=? AND product_id=?').get(order.id, product.id);
    if (item && (item.unit !== product.unit || item.unit_round_up !== product.unit_round_up)) fail('附加工序材料单位或取整规则已变化，请重新建单。', 409);
    if (!item) {
      const position = db.prepare('SELECT COALESCE(MAX(position),-1)+1 n FROM production_items WHERE production_id=?').get(order.id).n;
      db.prepare(`INSERT INTO production_items(production_id,product_id,name,barcode,specification,unit,base_quantity,base_quantity_fraction,loss_rate,planned_quantity,note,position,unit_round_up)
        VALUES (?,?,?,?,?,?,0,'',0,0,'',?,?)`).run(order.id, product.id, product.name, product.barcode, product.specification, product.unit, position, product.unit_round_up);
    }
    const quantity = materialQuantity(row.quantity, product);
    if (!validQuantity(quantity, true)) fail('附加工序计划用料需为正数，最多 4 位小数。');
    return { product_id: product.id, quantity };
  });
}

export function additionalMaterialReports(db, productionId) {
  return db.prepare("SELECT id,status,material_items FROM production_operation_reports WHERE production_id=? AND material_items!='[]' ORDER BY id").all(productionId)
    .map(row => ({ ...row, material_items: JSON.parse(row.material_items) }));
}

export function operationReportView(report, order) {
  return { ...report, material_items: JSON.parse(report.material_items).map(row => {
    const item = order.items.find(item => item.product_id === row.product_id);
    return { ...row, name: item.name, barcode: item.barcode, unit: item.unit };
  }) };
}

export function consumeAdditionalMaterials(db, req, order, route) {
  const configured = route.additional_materials || [], actuals = req.body.material_items ?? [];
  if (!Array.isArray(actuals) || actuals.length !== configured.length || new Set(actuals.map(row => row?.product_id)).size !== actuals.length)
    fail('请核对附加工序全部材料的实际耗料。');
  let total = 0;
  return actuals.map(row => {
    const item = order.items.find(item => item.product_id === row?.product_id);
    if (!item || !configured.some(item => item.product_id === row.product_id) ||
        row.variance_reason !== undefined && (typeof row.variance_reason !== 'string' || row.variance_reason.length > 500)) fail('附加工序实际耗料无效，请核对数量、材料及差异说明。');
    const product = db.prepare('SELECT active,unit,unit_round_up FROM products WHERE id=? AND warehouse_id=?').get(item.product_id, order.warehouse_id);
    if (!product?.active || product.unit !== item.unit || product.unit_round_up !== item.unit_round_up) fail('附加工序材料单位或取整规则已变化，请重新核对。', 409);
    const quantity = parseExactQuantity(row.quantity);
    if (exactCompare(quantity, exactQuantity(item, 'available_quantity')) > 0) fail(`${item.name}已领未耗余额不足（当前 ${item.available_quantity} ${item.unit}）。请补料或核对实际耗料。`, 409);
    const cost_cents = exactCompare(quantity, 0) > 0 ? allocate(item.available_cost_cents, quantity, exactQuantity(item, 'available_quantity')) : 0;
    total += cost_cents;
    if (!Number.isSafeInteger(total)) fail('附加工序材料成本超出范围。');
    return { product_id: row.product_id, ...quantityFields(quantity), cost_cents, variance_reason: row.variance_reason?.trim() || '' };
  });
}
