import { calculateBomNodes } from '../shared/bom-expansion.js';
import { productionItemQuantity } from '../shared/production.js';
import { stageInputDefaults } from '../shared/production-stages.js';
import { pooledProductionStages } from '../shared/production-pools.js';
import { t } from './i18n/index.js';
import { scrapExpectedQuantity } from '../shared/scrap.js';

// A route snapshot and BOM path identify the operation, never its display name.
export function registrationTargets(order) {
  const layers = order.stage_workflow ? pooledProductionStages(order) : [{ ...order, path: '' }];
  const byPath = new Map(layers.map(layer => [layer.path, layer]));
  const ancestors = layer => {
    const chain = [], seen = new Set();
    for (let current = byPath.get(layer.parent_path); current?.path && !seen.has(current.path); current = byPath.get(current.parent_path)) {
      seen.add(current.path); chain.unshift(current);
    }
    return chain;
  };
  const targets = layers.flatMap(layer => {
    const path = layer.path;
    const route = order.operation_routes?.find(row => row.path === path);
    return (route ? route.operations : [null]).map((node, index) => ({
      id: JSON.stringify([path, node?.id ?? null]), path, layer, node, ancestors: ancestors(layer),
      name: node?.name ?? layer.name ?? order.product_name,
      routeName: route?.route_name ?? '', bomName: layer.bom_name ?? order.bom_name,
      step: index + 1, unit: layer.unit, output: !node || node.is_output,
    }));
  });
  const count = key => {
    const totals = new Map();
    for (const target of targets) { const value = key(target); totals.set(value, (totals.get(value) || 0) + 1); }
    return target => totals.get(key(target));
  };
  const bomKey = row => JSON.stringify([row.name, row.routeName, row.bomName]);
  const names = count(row => row.name);
  const routes = count(row => JSON.stringify([row.name, row.routeName]));
  const boms = count(bomKey);
  const paths = count(row => JSON.stringify([row.name, row.routeName, row.bomName, row.path]));
  return targets.map(row => {
    let branch = '';
    if (boms(row) > 1) {
      const chains = targets.filter(peer => bomKey(peer) === bomKey(row)).map(peer => peer.ancestors);
      let common = 0;
      while (chains[0]?.[common] && chains.every(chain => chain[common]?.path === chains[0][common].path)) common++;
      branch = row.ancestors.slice(common).map(stage => stage.name).join(' / ');
    }
    return { ...row,
      context: row.layer.pool_paths ? `${t('production.sharedSemiFinished')} · ${row.layer.name}` : [names(row) > 1 && row.routeName, routes(row) > 1 && row.bomName, branch].filter(Boolean).join(' · '),
      showPath: boms(row) > 1, showStep: paths(row) > 1,
    };
  });
}

// Defaults follow the existing full registration forms, including rounding and scrap rules.
export function registrationDefaults(order, target, quantity) {
  if (!target.output) return { items: [], scraps: [] };
  const standards = !order.stage_workflow && order.snapshot_format === 2
    ? new Map(calculateBomNodes(order.nodes, quantity, order.quantity_decimals).rows.map(row => [row.product_id, row.required])) : null;
  const items = order.stage_workflow
    ? stageInputDefaults(target.layer.items, quantity).map(row => ({ ...row, product_id: target.layer.items.find(item=>item.path===row.path).product_id }))
    : target.layer.items.map(item => ({ product_id: item.product_id, quantity: String(productionItemQuantity(item, quantity, order, standards)), variance_reason: '' }));
  const scraps = target.path ? [] : (order.scraps || []).map(row => ({ product_id: row.product_id,
    quantity: String(scrapExpectedQuantity(row, quantity, order.base_quantity,
      items.map(item => ({ product_id: item.product_id, quantity: Number(item.quantity) })), order.quantity_decimals)), disposition: 'stock' }));
  return { items, scraps };
}
