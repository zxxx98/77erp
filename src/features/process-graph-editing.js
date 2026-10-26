// Client-side graph edits; the server still validates the complete route on save.
export function addProcessNode(graph, node, { anchorId, direction, edge } = {}) {
  if (graph.nodes.length >= 50) throw new Error('route.nodeLimit');
  if (anchorId && !graph.nodes.some(item => item.id === anchorId)) return graph;
  if (edge && !graph.edges.some(item => item.from === edge.from && item.to === edge.to)) return graph;
  if ((anchorId || edge) && graph.edges.length >= 200) throw new Error('route.edgeLimit');
  const clamp = value => Math.min(10000, Math.max(24, Math.round(value)));
  const placed = { ...node, x: clamp(node.x), y: clamp(node.y) };
  // Keep the drop location when possible; leave a row of breathing room otherwise.
  while (graph.nodes.some(item => Math.abs(item.x - placed.x) < 240 && Math.abs(item.y - placed.y) < 124)) {
    if (placed.y + 140 <= 10000) placed.y += 140;
    else { placed.y = 24; placed.x = placed.x + 240 <= 10000 ? placed.x + 240 : 24; }
  }
  let edges = [...graph.edges];
  if (edge) {
    edges = edges.filter(item => item.from !== edge.from || item.to !== edge.to);
    edges.push({ from: edge.from, to: node.id }, { from: node.id, to: edge.to });
  } else if (anchorId) {
    edges.push(direction === 'before' ? { from: node.id, to: anchorId } : { from: anchorId, to: node.id });
  }
  return { ...graph, nodes: [...graph.nodes, placed], edges };
}
