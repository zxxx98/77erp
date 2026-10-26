// A route describes operations on one production layer, in that layer's output unit.
// Cross-layer material ratios continue to be governed by the BOM.
export function validateProcessGraph(graph) {
  const fail = message => { throw new Error(message); };
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !graph.nodes.length || graph.nodes.length > 50 || graph.edges.length > 200)
    fail('工艺路线需要 1 至 50 道工序，连线最多 200 条。');
  const ids = new Set();
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(node.id) || ids.has(node.id) ||
        typeof node.name !== 'string' || !node.name.trim() || node.name.length > 80 ||
        typeof node.note !== 'string' || node.note.length > 500 ||
        ![node.x, node.y].every(value => Number.isFinite(value) && value >= 0 && value <= 10000))
      fail('工序编号、名称、作业说明或位置无效。');
    ids.add(node.id);
  }
  const seen = new Set(), incoming = new Map(graph.nodes.map(n => [n.id, []])), outgoing = new Map(graph.nodes.map(n => [n.id, []]));
  for (const edge of graph.edges) {
    if (!edge || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || seen.has(`${edge.from}:${edge.to}`))
      fail('工序连线不能重复、自连或指向不存在的工序。');
    seen.add(`${edge.from}:${edge.to}`); incoming.get(edge.to).push(edge.from); outgoing.get(edge.from).push(edge.to);
  }
  const remaining = new Map([...incoming].map(([id, parents]) => [id, parents.length]));
  const queue = graph.nodes.filter(n => remaining.get(n.id) === 0).map(n => n.id), order = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]; order.push(id);
    for (const child of outgoing.get(id)) { remaining.set(child, remaining.get(child) - 1); if (!remaining.get(child)) queue.push(child); }
  }
  if (order.length !== graph.nodes.length) fail('工艺路线存在循环，请检查前置工序。');
  const outputs = graph.nodes.filter(n => !outgoing.get(n.id).length);
  if (outputs.length !== 1) fail('工艺路线需要唯一的最终产出工序，请连接所有分支后汇合。');
  return { incoming, outgoing, order, output: outputs[0].id };
}

export function arrangeProcessGraph(graph) {
  const { order, incoming } = validateProcessGraph(graph), depth = new Map(), rows = new Map();
  for (const id of order) depth.set(id, Math.max(-1, ...incoming.get(id).map(parent => depth.get(parent))) + 1);
  const maxDepth = Math.max(1, ...depth.values()), columnGap = Math.min(240, Math.floor((10000 - 24) / maxDepth));
  return { ...graph, nodes: graph.nodes.map(node => {
    const column = depth.get(node.id), row = rows.get(column) || 0; rows.set(column, row + 1);
    return { ...node, x: 24 + column * columnGap, y: 24 + row * 140 };
  }) };
}

export function processProgress(graph, reports) {
  const { incoming, output, order } = validateProcessGraph(graph);
  const quantity = id => reports.filter(r => r.node_id === id && r.status === 'active').reduce((sum, r) => Math.round((sum + r.quantity) * 10000) / 10000, 0);
  return order.map(id => {
    const completed_quantity = quantity(id), parents = incoming.get(id);
    const available_quantity = parents.length ? Math.max(0, Math.round((Math.min(...parents.map(quantity)) - completed_quantity) * 10000) / 10000) : null;
    return { ...graph.nodes.find(n => n.id === id), completed_quantity, available_quantity, is_output: id === output, predecessors: parents };
  });
}
