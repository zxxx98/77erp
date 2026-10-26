import { arrangeProcessGraph, validateProcessGraph } from './process-routes.js';
import { deriveProductionStages } from './production-stages.js';

export const OVERVIEW_PAGE_SIZE = 6;
const keyFor = (path, id) => `${path || 'root'}:${id}`;

// Only immutable order data belongs here: never resolve current product/BOM bindings.
export function productionOverviewLayers(order) {
  const routes = new Map((order.operation_routes || []).map(route => [route.path, route]));
  const derived = order.stages?.length ? order.stages : deriveProductionStages(order);
  const stages = derived.length ? derived : [{ path: '', parent_path: null, name: order.product_name,
    bom_id: order.bom_id, bom_name: order.bom_name, unit: order.unit,
    planned_quantity: order.planned_quantity, completed_quantity: order.completed_quantity }];
  return stages.map(stage => {
    const route = routes.get(stage.path);
    return { ...stage, route_source: route ? 'snapshot' : null,
      completed_quantity: stage.completed_quantity ?? (stage.path === '' ? order.completed_quantity : null),
      materials: (stage.items || []).filter(item => item.usage_mode === 'stock'),
      route: route ? { name: route.route_name, version: route.route_version, graph: route.graph, operations: route.operations || [] } : null };
  });
}

// A page contains the selected parent and six children. Search adds the selected
// matches' ancestors, so supply edges never float without their parent context.
export function overviewScope(layers, scope = '', query = '', page = 0, expandedDepth = 1) {
  const byPath = new Map(layers.map(layer => [layer.path, layer]));
  const term = query.trim().toLocaleLowerCase();
  const matches = term ? layers.filter(layer => [layer.name, layer.bom_name, layer.barcode, layer.path, layer.route?.name].join(' ').toLocaleLowerCase().includes(term))
    : layers.filter(layer => layer.path !== scope && layer.parent_path === scope);
  const currentPage = Math.max(0, Math.min(page, Math.ceil(matches.length / OVERVIEW_PAGE_SIZE) - 1));
  const chosen = matches.slice(currentPage * OVERVIEW_PAGE_SIZE, (currentPage + 1) * OVERVIEW_PAGE_SIZE);
  const selected = new Set(term ? [] : [scope]);
  for (const layer of chosen) {
    let current = layer;
    while (current && !selected.has(current.path)) {
      selected.add(current.path);
      current = term && current.parent_path != null ? byPath.get(current.parent_path) : null;
    }
  }
  let limited = false;
  if (!term && expandedDepth > 1) {
    let frontier = chosen;
    const children = new Map();
    for (const layer of layers) {
      const siblings = children.get(layer.parent_path) || [];
      siblings.push(layer); children.set(layer.parent_path, siblings);
    }
    for (let level = 1; level < Math.min(10, expandedDepth) && frontier.length; level++) {
      const next = [];
      for (const parent of frontier) for (const child of children.get(parent.path) || []) {
        if (selected.size >= 24) { limited = true; break; }
        selected.add(child.path); next.push(child);
      }
      frontier = next;
    }
  }
  return { layers: layers.filter(layer => selected.has(layer.path)), matches: chosen.map(layer => layer.path),
    total: matches.length, page: currentPage, limited, hasMore: (currentPage + 1) * OVERVIEW_PAGE_SIZE < matches.length };
}

export function layoutOverview(layers, collapsed = new Set()) {
  const groups = layers.map(layer => {
    const folded = collapsed.has(layer.path);
    const graph = !folded && layer.route ? arrangeProcessGraph(layer.route.graph) : null;
    const output = graph ? validateProcessGraph(graph).output : null;
    const operations = new Map((layer.route?.operations || []).map(op => [op.id, op]));
    const nodes = folded ? [] : graph ? graph.nodes.map(node => ({ ...node, key: keyFor(layer.path, node.id),
      x: 24 + (node.x - 24) * 1.16, y: 164 + (node.y - 24) * 1.1, output: node.id === output, progress: operations.get(node.id) }))
      : [{ id: 'unconfigured', key: keyFor(layer.path, 'unconfigured'), name: layer.name, x: 24, y: 164, output: true, placeholder: true }];
    return { ...layer, folded, nodes, edges: graph?.edges || [],
      width: Math.max(420, ...nodes.map(node => node.x + 212)), height: folded ? 174 : Math.max(290, ...nodes.map(node => node.y + 126)),
      depth: layer.path ? layer.path.split('.').length : 0 };
  });
  const depths = [...new Set(groups.map(group => group.depth))].sort((a, b) => b - a);
  let x = 24, height = 0;
  for (const depth of depths) {
    const column = groups.filter(group => group.depth === depth);
    let y = 24;
    for (const group of column) { group.x = x; group.y = y; y += group.height + 32; }
    x += Math.max(...column.map(group => group.width)) + 144;
    height = Math.max(height, y);
  }
  const byPath = new Map(groups.map(group => [group.path, group]));
  const supplyEdges = groups.filter(group => group.parent_path != null && byPath.has(group.parent_path)).map(group => {
    const parent = byPath.get(group.parent_path), output = group.nodes.find(node => node.output);
    return { fromPath: group.path, toPath: parent.path, sourceKey: output?.key ?? keyFor(group.path, 'folded-output'), targetKind: 'group-inlet',
      x1: group.x + (output ? output.x + 180 : group.width), y1: group.y + (output ? output.y + 44 : 132), x2: parent.x, y2: parent.y + 137 };
  });
  return { groups, supplyEdges, width: Math.max(360, x - 120), height: Math.max(240, height) };
}
