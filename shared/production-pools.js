import { addQuantity } from './quantity.js';
import { stageDisplayStandardQuantity } from './production-stages.js';

// Pool only identical saved recipes, including child supply decisions and routes.
// A batch keeps its original path for audit; that path does not reserve its use.
export function productionPools(order) {
  const stages = order.stages || [], routes = order.operation_routes || [];
  const routeKey = path => {
    const route = routes.find(row => row.path === path);
    return route ? [route.route_id, route.route_version, typeof route.graph === 'string' ? JSON.parse(route.graph) : route.graph] : null;
  };
  const recipe = path => (order.nodes || []).filter(n => n.parent_path === path).map(n => [
    ...['product_id','unit','unit_round_up','bom_id','bom_version','bom_base_quantity','quantity','quantity_fraction','loss_rate','loss_method','usage_mode','supply_fraction'].map(key => n[key] ?? null),
    n.usage_mode === 'explode' ? [routeKey(n.path), recipe(n.path)] : null,
  ]);
  const groups = new Map();
  for (const stage of stages) {
    const key = stage.path && order.nodes?.length ? JSON.stringify([
      stage.product_id, stage.unit, stage.unit_round_up, stage.bom_id, stage.bom_version,
      stage.base_quantity, stage.loss_method, routeKey(stage.path), recipe(stage.path),
    ]) : `path:${stage.path}`;
    const group = groups.get(key) || []; group.push(stage); groups.set(key, group);
  }
  return [...groups.values()];
}

export function stagePoolPaths(order, path) {
  return productionPoolPathMap(order).get(path) || [path];
}

export function productionPoolPathMap(order) {
  const paths=new Map();
  for(const group of productionPools(order)) {
    const members=group.map(stage=>stage.path);
    for(const stage of group) paths.set(stage.path,members);
  }
  return paths;
}

export function pooledProductionStages(order) {
  return productionPools(order).map(group => {
    const first = group[0], sum = key => group.reduce((total, row) => addQuantity(total, row[key] || 0), 0);
    if (group.length === 1) return first;
    return { ...first, pool_paths: group.map(row => row.path),
      planned_quantity: sum('planned_quantity'), completed_quantity: sum('completed_quantity'),
      available_quantity: sum('available_quantity'), consumed_quantity: sum('consumed_quantity'),
      ...(group.some(row => row.available_cost_cents !== undefined) ? { available_cost_cents: group.reduce((n,row) => n + (row.available_cost_cents || 0), 0) } : {}),
      items: first.items.map((item, index) => {
        const peers = group.map(stage => stage.items[index]);
        return { ...item, actual_quantity: peers.reduce((n, row) => addQuantity(n, row.actual_quantity || 0), 0),
          standard_quantity: (() => { try { return stageDisplayStandardQuantity(item, sum('completed_quantity')); } catch { return null; } })() };
      }),
      pool_usages: group.flatMap(stage => stage.pool_usages || []).reduce((rows, usage) => {
        const prior = rows.find(row => row.path === usage.path);
        if (prior) prior.quantity = addQuantity(prior.quantity, usage.quantity); else rows.push({ ...usage });
        return rows;
      }, []),
    };
  });
}

export function productionPoolOrder(data, order) {
  return { ...order, stages: data.production_stages.filter(s => s.production_id === order.id),
    nodes: data.production_bom_nodes.filter(n => n.production_id === order.id).sort((a,b) => a.position-b.position),
    operation_routes: data.production_routes.filter(r => r.production_id === order.id) };
}
