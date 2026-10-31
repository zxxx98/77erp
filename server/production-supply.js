import { buildBomNodes, calculateBomNode, validateExpansionScraps, BOM_MAX_DEPTH, BOM_MAX_NODES } from '../shared/bom-expansion.js';
import { validQuantity, quantityUnits, addQuantity } from '../shared/quantity.js';

const fail = message => { throw new Error(message); };

// Source paths belong to recipe lines; saved paths belong to the effective order.
// Splitting one recipe line into two inputs does not change the recipe itself.
export function buildProductionSupply(root, load, productionQuantity, choices, recipesFor) {
  if (!Array.isArray(choices) || choices.length > BOM_MAX_NODES) fail('生产用料选择无效。');
  const selected = new Map();
  for (const choice of choices) {
    if (!choice || typeof choice.path !== 'string' || !/^[1-9]\d*(\.[1-9]\d*)*$/.test(choice.path) ||
        selected.has(choice.path) || !['stock','produce','partial'].includes(choice.mode) ||
        choice.child_bom_id != null && (!Number.isSafeInteger(choice.child_bom_id) || choice.child_bom_id < 1) ||
        choice.mode === 'partial' && !validQuantity(choice.stock_quantity, true)) fail('生产用料选择、配方或库存领用数量无效。');
    selected.set(choice.path, choice);
  }
  const nodes = [], supplies = [], visited = new Set(), amounts = new Map();
  function visit(bom, sourceParent, actualParent, ancestors) {
    if (ancestors.includes(bom.id) || ancestors.length >= BOM_MAX_DEPTH) fail('生产配方循环引用或层级超过上限。');
    if (sourceParent && bom.scraps.length) fail('下级配方包含废料规则，请改为使用库存并单独生产。');
    // Validate only the recipe being used; unselected descendants need not be available.
    const direct = buildBomNodes({ ...bom, items: bom.items.map(item => ({ ...item, usage_mode: 'stock', child_bom_id: null })) }, load);
    let sibling = 0;
    for (let i = 0; i < direct.length; i++) {
      const original = bom.items[i], template = direct[i];
      const sourcePath = sourceParent ? `${sourceParent}.${i + 1}` : `${i + 1}`;
      const options = recipesFor(template.product_id);
      const choice = selected.get(sourcePath);
      if (choice) visited.add(sourcePath);
      const mode = choice?.mode ?? (original.usage_mode === 'explode' ? 'produce' : 'stock');
      const childId = choice?.child_bom_id ?? original.child_bom_id;
      const required = calculateBomNode(template, amounts.get(actualParent), productionQuantity).required;
      const stockQuantity = mode === 'stock' ? required : mode === 'partial' ? choice.stock_quantity : 0;
      if (mode === 'partial' && (stockQuantity >= required || template.unit_round_up && !Number.isInteger(stockQuantity))) fail(`${template.name}库存领用量需小于本层需求，取整物料须填写整数。`);
      const supply = { path: sourcePath, product_id: template.product_id, name: template.name, unit: template.unit,
        unit_round_up: template.unit_round_up, required, stock: original.product.stock, mode,
        stock_quantity: stockQuantity, production_quantity: addQuantity(required, -stockQuantity),
        child_bom_id: childId ?? null, recipe_options: options };
      supplies.push(supply);
      const append = (usage_mode, share = '') => {
        const path = actualParent ? `${actualParent}.${++sibling}` : `${++sibling}`;
        const node = { ...template, path, parent_path: actualParent, usage_mode, child_bom_id: usage_mode === 'explode' ? childId : null,
          supply_fraction: share, position: nodes.length };
        amounts.set(path, calculateBomNode(node, amounts.get(actualParent), productionQuantity).amount);
        nodes.push(node);
        if (nodes.length > BOM_MAX_NODES) fail('生产用料节点超过上限。');
        return node;
      };
      if (mode === 'stock') append('stock');
      else {
        const child = childId ? load(childId) : null;
        if (!child || child.warehouse_id !== root.warehouse_id || child.product_id !== template.product_id) fail(`${template.name}请选择本次生产使用的下级配方。`);
        let share = '';
        if (mode === 'partial') {
          const total = quantityUnits(required), stock = quantityUnits(stockQuantity);
          append('stock', `${stock}/${total}`);
          share = `${total - stock}/${total}`;
        }
        const node = append('explode', share);
        visit(child, sourcePath, node.path, [...ancestors, bom.id]);
      }
    }
  }
  visit(root, '', '', []);
  if ([...selected.keys()].some(path => !visited.has(path))) fail('生产用料层级已变化，请重新选择并测算。');
  if (nodes.some(node => node.usage_mode === 'stock' && node.product_id === root.product_id)) fail('最终领料不能包含本单成品。');
  validateExpansionScraps(root.scraps, nodes);
  return { nodes, supplies };
}
