import { test } from 'node:test';
import assert from 'node:assert/strict';

const graph = { nodes: ['a', 'b', 'out'].map(id => ({ id, name: id, note: '', x: 24, y: 24 })), edges: [{ from: 'a', to: 'out' }, { from: 'b', to: 'out' }] };
const layer = (path, parent_path, route = { name: '路线', graph }) => ({ path, parent_path, name: `物料${path}`, bom_name: `配方${path}`, unit: path ? '根' : '件', route });
const model = () => import('../shared/process-overview.js');

test('overview preserves parallel edges and gives repeated routes unique IDs; supply enters parent group', async () => {
  const { layoutOverview } = await model();
  const result = layoutOverview([layer('', null), layer('1', ''), layer('2', '')]);
  assert.equal(result.groups.length, 3);
  const ids = result.groups.flatMap(g => g.nodes.map(n => n.key));
  assert.equal(new Set(ids).size, 9);
  for (const group of result.groups) {
    assert.deepEqual(group.edges.map(e => [e.from, e.to]), [['a', 'out'], ['b', 'out']]);
    assert.ok(group.nodes.find(n => n.id === 'a').x < group.nodes.find(n => n.id === 'out').x);
  }
  assert.equal(result.supplyEdges.length, 2);
  assert.ok(result.supplyEdges.every(e => e.toPath === '' && e.targetKind === 'group-inlet'));
  assert.ok(result.supplyEdges.every(e => e.sourceKey !== undefined && e.targetNodeId === undefined));
  for (const a of result.groups) for (const b of result.groups) if (a !== b)
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
});

test('unconfigured and folded layers keep an output and supply connection without mutating graphs', async () => {
  const { layoutOverview } = await model();
  const layers = [layer('', null), layer('1', '', null), layer('2', '')], before = JSON.stringify(layers);
  const result = layoutOverview(layers, new Set(['2']));
  assert.equal(result.groups.find(g => g.path === '1').nodes.length, 1);
  assert.equal(result.groups.find(g => g.path === '2').nodes.length, 0);
  assert.equal(result.supplyEdges.length, 2);
  assert.equal(JSON.stringify(layers), before);
});

test('production overview uses only snapshots, keeps output totals separate from intermediate reports', async () => {
  const { productionOverviewLayers } = await model();
  const order = { product_name: '产品', unit: '件', stages: [
    { ...layer('', null), planned_quantity: 10, completed_quantity: 2 },
    { ...layer('1', ''), planned_quantity: 40, completed_quantity: 8, available_quantity: 4, consumed_quantity: 4 },
  ], operation_routes: [{ path: '1', route_name: '旧路线', route_version: 7, graph, operations: [{ id: 'a', completed_quantity: 30 }, { id: 'out', completed_quantity: 8 }] }] };
  const result = productionOverviewLayers(order);
  assert.equal(result[0].route, null);
  assert.equal(result[1].route.name, '旧路线');
  assert.equal(result[1].route.version, 7);
  assert.equal(result[1].completed_quantity, 8);
  assert.equal(result[1].unit, '根');
  assert.equal(result[1].route.operations[0].completed_quantity, 30);
  assert.equal(result[1].route_source, 'snapshot');
});

test('single layer historical orders remain viewable without routes', async () => {
  const { productionOverviewLayers } = await model();
  const result = productionOverviewLayers({ product_name: '旧产品', unit: '箱', planned_quantity: 9, completed_quantity: 3 });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, '旧产品');
  assert.equal(result[0].route, null);
  assert.equal(result[0].completed_quantity, 3);
});

test('large overview is bounded, branch pages remain connected and search retains ancestors', async () => {
  const { overviewScope } = await model();
  const layers = [layer('', null), ...Array.from({ length: 100 }, (_, i) => layer(`${i + 1}`, '')), layer('90.1', '90')];
  const first = overviewScope(layers, '', '', 0);
  assert.equal(first.layers.length, 7);
  assert.equal(first.total, 100);
  const second = overviewScope(layers, '', '', 1);
  assert.equal(second.layers[0].path, '');
  assert.equal(second.layers[1].path, '7');
  const search = overviewScope(layers, '', '配方90.1', 0);
  assert.deepEqual(search.layers.map(l => l.path), ['', '90', '90.1']);
  assert.equal(search.total, 1);
  const branch = overviewScope(layers, '90', '', 0);
  assert.deepEqual(branch.layers.map(l => l.path), ['90', '90.1']);
});

test('expanding sublayers keeps multiple generations together and bounds the rendered graph', async () => {
  const { overviewScope } = await model();
  const layers = [layer('', null), layer('1', ''), layer('2', ''), layer('1.1', '1'), layer('2.1', '2')];
  assert.equal(overviewScope(layers, '', '', 0, 2).layers.length, 5);
  const large = [layer('', null)];
  for (let i = 1; i <= 6; i++) {
    large.push(layer(`${i}`, ''));
    for (let j = 1; j <= 6; j++) large.push(layer(`${i}.${j}`, `${i}`));
  }
  const result = overviewScope(large, '', '', 0, 10);
  assert.ok(result.layers.length <= 24);
  assert.ok(result.limited);
  assert.ok(result.layers.every(item => item.parent_path == null || result.layers.some(parent => parent.path === item.parent_path)));
});
