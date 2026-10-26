import test from 'node:test';
import assert from 'node:assert/strict';
import { addProcessNode } from '../src/features/process-graph-editing.js';
import { arrangeProcessGraph, validateProcessGraph } from '../shared/process-routes.js';

const original = () => ({ nodes: [{ id: 'a', name: 'A', x: 24, y: 24 }, { id: 'b', name: 'B', x: 244, y: 24 }], edges: [{ from: 'a', to: 'b' }] });
const node = { id: 'c', name: 'C', note: '', x: 400, y: 200 };

test('handle gestures add a predecessor or successor without changing existing edges', () => {
  const graph = original(), snapshot = structuredClone(graph);
  for (const direction of ['before', 'after']) {
    const next = addProcessNode(graph, node, { anchorId: 'a', direction });
    assert.deepEqual(next.edges, [...graph.edges, direction === 'before' ? { from: 'c', to: 'a' } : { from: 'a', to: 'c' }]);
    assert.equal(next.nodes.length, 3);
  }
  assert.deepEqual(graph, snapshot);
});

test('edge insertion replaces only the chosen edge', () => {
  const graph = original(); graph.edges.push({ from: 'b', to: 'a' });
  const next = addProcessNode(graph, node, { edge: { from: 'a', to: 'b' } });
  assert.deepEqual(next.edges, [{ from: 'b', to: 'a' }, { from: 'a', to: 'c' }, { from: 'c', to: 'b' }]);
});

test('independent creation preserves edges and bounds positions without overlap', () => {
  const graph = original();
  const next = addProcessNode(graph, { ...node, x: 24, y: 24 });
  assert.deepEqual(next.edges, graph.edges);
  assert.ok(next.nodes.at(-1).y >= 124);
  const bounded = addProcessNode(graph, { ...node, x: -10, y: 20000 }).nodes.at(-1);
  assert.equal(bounded.x, 24); assert.equal(bounded.y, 10000);
});

test('stale anchor and edge requests do not modify the graph', () => {
  const graph = original();
  assert.equal(addProcessNode(graph, node, { anchorId: 'missing', direction: 'after' }), graph);
  assert.equal(addProcessNode(graph, node, { edge: { from: 'b', to: 'a' } }), graph);
});

test('node and edge limits are enforced for all creation paths', () => {
  const graph = original(); graph.nodes = Array.from({ length: 50 }, (_, i) => ({ ...node, id: `n${i}` }));
  assert.throws(() => addProcessNode(graph, node), /route.nodeLimit/);
  const full = original(); full.edges = Array.from({ length: 200 }, () => ({ from: 'a', to: 'b' }));
  assert.throws(() => addProcessNode(full, node, { anchorId: 'a', direction: 'after' }), /route.edgeLimit/);
  assert.throws(() => addProcessNode(full, node, { edge: { from: 'a', to: 'b' } }), /route.edgeLimit/);
  assert.equal(addProcessNode(full, node).nodes.length, 3);
});

test('auto arrange keeps a maximum-length route within the saved coordinate limits', () => {
  const nodes = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, name: `工序 ${i}`, note: '', x: 24 + i * 190, y: 24 }));
  const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id }));
  const arranged = arrangeProcessGraph({ nodes, edges });
  assert.doesNotThrow(() => validateProcessGraph(arranged));
  assert.equal(new Set(arranged.nodes.map(n => n.x)).size, 50);
});
