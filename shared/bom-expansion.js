import { validateBom, validateBomQuantity, validateBomLossRate, validateBomLossMethod } from './bom.js';
import { MAX_QUANTITY, QUANTITY_SCALE, quantityUnits, validQuantity } from './quantity.js';

export const BOM_MAX_DEPTH = 10;
export const BOM_MAX_NODES = 2000;
export const BOM_MAX_MATERIALS = 500;
export const bomUsageLabels = { stock: '领用本物料', explode: '展开下级 BOM' };
export const BOM_NODE_COLUMNS = ['path','parent_path','bom_id','bom_version','bom_name','bom_product_id','bom_product_name','bom_base_quantity','bom_base_unit','loss_method','product_id','name','barcode','specification','unit','quantity','quantity_fraction','loss_rate','usage_mode','child_bom_id','note','position'];
const fail = message => { throw new Error(message); };
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const ratio = (n, d = 1n) => {
  if (n.toString(2).length > 4096 || d.toString(2).length > 4096) fail('BOM计算比例过大，请简化配方。');
  const g = gcd(n, d); return [n / g, d / g];
};
const multiply = (a, b) => ratio(a[0] * b[0], a[1] * b[1]);
const add = (a, b) => ratio(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const decimal = value => ratio(BigInt(quantityUnits(value)), BigInt(QUANTITY_SCALE));
const rounded = value => {
  const scaled = (value[0] * BigInt(QUANTITY_SCALE) + value[1] - 1n) / value[1];
  if (scaled > BigInt(MAX_QUANTITY * QUANTITY_SCALE)) fail('材料需求超出数量上限，请减少生产数量。');
  return Number(scaled) / QUANTITY_SCALE;
};

function itemRatio(node) {
  const net = node.quantity_fraction ? node.quantity_fraction.split('/').map(BigInt) : decimal(node.quantity);
  const base = decimal(node.bom_base_quantity), scale = BigInt(100 * QUANTITY_SCALE), rate = BigInt(quantityUnits(node.loss_rate));
  return multiply(multiply(net, [base[1], base[0]]), node.loss_method === 'external' ? [scale + rate, scale] : [scale, scale - rate]);
}

// Both live calculations and immutable production snapshots use these exact
// rational paths. Rounded node quantities are for display only.
export function calculateBomNodes(nodes, productionQuantity) {
  if (!validQuantity(productionQuantity, true)) fail('生产数量需为正数，最多 6 位小数。');
  const values = new Map(), totals = new Map(), leaves = new Map();
  const multi = nodes.some(node => node.usage_mode === 'explode');
  const calculated = nodes.map(node => {
    const parent = node.parent_path ? values.get(node.parent_path) : decimal(productionQuantity);
    if (!parent) fail('BOM节点父子关联或排序无效。');
    const amount = multiply(parent, itemRatio(node));
    values.set(node.path, amount);
    if (node.usage_mode === 'stock') {
      totals.set(node.product_id, add(totals.get(node.product_id) || [0n, 1n], amount));
      leaves.set(node.product_id, [...(leaves.get(node.product_id) || []), node]);
    }
    return { ...node, required: rounded(amount) };
  });
  const rows = [...totals].map(([product_id, amount]) => {
    const sources = leaves.get(product_id), first = sources[0];
    return { product_id, name: first.name, barcode: first.barcode, specification: first.specification, unit: first.unit,
      quantity: multi ? null : first.quantity, quantity_fraction: multi ? null : first.quantity_fraction,
      loss_rate: multi ? null : first.loss_rate, note: multi ? '' : first.note,
      required: rounded(amount), sources: sources.map(node => node.path) };
  });
  if (rows.length > BOM_MAX_MATERIALS) fail(`最终领料物料不能超过 ${BOM_MAX_MATERIALS} 种。`);
  return { nodes: calculated, rows, multi_level: multi };
}

// Follow selected BOM IDs, never a product's arbitrary first recipe.
export function buildBomNodes(root, loadBom, { availability = true, scrapRules = true } = {}) {
  const nodes = [], stack = [], pathNames = [];
  function visit(bom, parentPath = '') {
    const label = `${bom.product?.name || bom.product_id}［${bom.name} #${bom.id}］`;
    if (stack.includes(bom.id)) fail(`BOM循环引用：${[...pathNames, label].join(' → ')}`);
    if (stack.length >= BOM_MAX_DEPTH) fail(`BOM最多支持 ${BOM_MAX_DEPTH} 层。`);
    validateBom(bom);
    stack.push(bom.id); pathNames.push(label);
    const location = () => pathNames.join(' → ');
    if (availability) {
      if (!bom.enabled) fail(`${location()}：BOM已停用。`);
      if (!bom.product?.active || [...bom.items, ...(bom.scraps || [])].some(row => !row.product?.active)) fail(`${location()}：成品、材料或废料已停用。`);
      if (bom.base_unit !== bom.product.unit || [...bom.items, ...(bom.scraps || [])].some(row => row.unit !== row.product.unit))
        throw Object.assign(new Error(`${location()}：物料单位已变化，请核对配方并重新保存。`), { status: 409 });
    }
    if (parentPath && scrapRules && bom.scraps?.length) fail(`${location()}：下级配方包含废料规则，本期请改为领用本物料并单独生产。`);
    for (let index = 0; index < bom.items.length; index++) {
      const item = bom.items[index], mode = item.usage_mode ?? 'stock';
      const path = parentPath ? `${parentPath}.${index + 1}` : `${index + 1}`;
      if (++visit.count > BOM_MAX_NODES) fail(`展开材料节点不能超过 ${BOM_MAX_NODES} 个。`);
      const node = { path, parent_path: parentPath, bom_id: bom.id, bom_version: bom.version, bom_name: bom.name,
        bom_product_id: bom.product_id, bom_product_name: bom.product?.name || '', bom_base_quantity: bom.base_quantity,
        bom_base_unit: bom.base_unit, loss_method: bom.loss_method ?? 'internal', product_id: item.product_id,
        name: item.product?.name || item.name, barcode: item.product?.barcode || item.barcode,
        specification: item.product?.specification ?? item.specification ?? '', unit: item.unit, quantity: item.quantity,
        quantity_fraction: item.quantity_fraction ?? '', loss_rate: item.loss_rate ?? 0, usage_mode: mode,
        child_bom_id: item.child_bom_id ?? null, note: item.note, position: nodes.length };
      nodes.push(node);
      if (mode === 'explode') {
        const child = loadBom(item.child_bom_id);
        if (!child || child.warehouse_id !== root.warehouse_id || child.product_id !== item.product_id)
          fail(`${location()} → ${node.name}：请选择当前物料在当前仓库的下级配方。`);
        visit(child, path);
      } else if (item.product_id === root.product_id) fail(`${location()}：最终领料不能包含本单成品。`);
    }
    stack.pop(); pathNames.pop();
  }
  visit.count = 0; visit(root);
  const leafIds = new Set(nodes.filter(row => row.usage_mode === 'stock').map(row => row.product_id));
  if (leafIds.size > BOM_MAX_MATERIALS) fail(`最终领料物料不能超过 ${BOM_MAX_MATERIALS} 种。`);
  if (scrapRules) validateExpansionScraps(root.scraps || [], nodes);

  return nodes;
}

export function validateExpansionScraps(scraps, nodes) {
  if (!nodes.some(row => row.usage_mode === 'explode')) return;
  for (const rule of scraps) {
    if (nodes.some(row => row.product_id === rule.product_id)) fail('根BOM废料不能与展开结构中的材料或半成品相同。');
    if (rule.method === 'input_ratio') {
      const sources = nodes.filter(row => row.product_id === rule.source_product_id && row.usage_mode === 'stock');
      if (sources.length !== 1 || sources[0].parent_path !== '') fail('按投入比例的废料来源必须直接领用，且不能同时出现在其他展开路径。');
    }
  }
}

export function validateSnapshotNodes(order, nodes) {
  if (!Array.isArray(nodes) || !nodes.length || nodes.length > BOM_MAX_NODES) fail('生产配方节点数量无效。');
  const paths = new Map(), definitions = new Map(), contexts = new Map(), products = new Map();
  const text = (v, max, required = false) => typeof v === 'string' && v.length <= max && (!required || v.trim());
  for (const node of nodes) {
    if (!text(node.path, 80, true) || !/^[1-9]\d*(\.[1-9]\d*)*$/.test(node.path) || paths.has(node.path) ||
        node.parent_path !== node.path.split('.').slice(0, -1).join('.') || !Number.isSafeInteger(node.bom_id) || node.bom_id < 1 ||
        !Number.isSafeInteger(node.bom_version) || node.bom_version < 1 || !Number.isSafeInteger(node.bom_product_id) || node.bom_product_id < 1 ||
        !text(node.bom_name, 100, true) || !text(node.bom_product_name, 100, true) || !validQuantity(node.bom_base_quantity, true) || !text(node.bom_base_unit, 100, true) ||
        !text(node.name, 100, true) || !text(node.barcode, 100, true) || !text(node.specification, 500) || !text(node.unit, 100, true) || !text(node.note, 200) ||
        node.position !== paths.size) fail('生产配方节点字段或路径无效。');
    validateBomQuantity(node.quantity, node.quantity_fraction); validateBomLossRate(node.loss_rate); validateBomLossMethod(node.loss_method);
    const productSignature = JSON.stringify([node.name, node.barcode, node.specification, node.unit]);
    if (products.has(node.product_id) && products.get(node.product_id) !== productSignature) fail('同一生产物料的节点快照不一致。');
    products.set(node.product_id, productSignature);
    paths.set(node.path, node);
    const context = contexts.get(node.parent_path) || []; context.push(node); contexts.set(node.parent_path, context);
  }
  for (const [parentPath, group] of contexts) {
    const first = group[0], parent = paths.get(parentPath);
    if (parentPath && (!parent || parent.usage_mode !== 'explode' || parent.child_bom_id !== first.bom_id || parent.product_id !== first.bom_product_id || parent.unit !== first.bom_base_unit || parent.name !== first.bom_product_name)) fail('生产配方子节点关联无效。');
    const header = row => [row.bom_id, row.bom_version, row.bom_name, row.bom_product_id, row.bom_product_name, row.bom_base_quantity, row.bom_base_unit, row.loss_method];
    if (group.some((row, i) => row.path !== `${parentPath ? `${parentPath}.` : ''}${i + 1}` || JSON.stringify(header(row)) !== JSON.stringify(header(first)))) fail('生产配方节点来源或排序不一致。');
    const bom = { id: first.bom_id, version: first.bom_version, name: first.bom_name, product_id: first.bom_product_id,
      product: { name: first.bom_product_name }, base_quantity: first.bom_base_quantity, base_unit: first.bom_base_unit,
      loss_method: first.loss_method, note: '', enabled: 1, warehouse_id: order.warehouse_id,
      items: group.map(row => ({ ...row, product: { name: row.name, barcode: row.barcode, specification: row.specification } })), scraps: [] };
    validateBom(bom);
    const signature = JSON.stringify([header(first), bom.items.map(row => [row.product_id, row.name, row.barcode, row.specification, row.unit, row.quantity, row.quantity_fraction, row.loss_rate, row.usage_mode, row.child_bom_id, row.note])]);
    if (definitions.has(bom.id) && definitions.get(bom.id).signature !== signature) fail('同一生产配方的重复引用内容不一致。');
    definitions.set(bom.id, { bom, signature });
  }
  const root = definitions.get(order.bom_id)?.bom;
  if (!root || root.version !== order.bom_version || root.name !== order.bom_name || root.product_id !== order.product_id || root.product.name !== order.product_name || root.base_quantity !== order.base_quantity || root.base_unit !== order.unit || root.loss_method !== order.loss_method) fail('生产根配方快照不一致。');
  const rebuilt = buildBomNodes(root, id => definitions.get(id)?.bom, { availability: false, scrapRules: false });
  if (JSON.stringify(rebuilt.map(node => BOM_NODE_COLUMNS.map(key => node[key]))) !== JSON.stringify(nodes.map(node => BOM_NODE_COLUMNS.map(key => node[key])))) fail('生产配方节点结构或内容不一致。');
  return calculateBomNodes(nodes, order.planned_quantity);
}
