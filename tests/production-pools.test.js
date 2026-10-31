import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionPools, pooledProductionStages, stagePoolPaths } from '../shared/production-pools.js';

const fixture = () => {
  const nodes = ['1','2'].map(path => ({ path: `${path}.1`, parent_path: path, product_id: 3, unit: 'M', unit_round_up: 0,
    bom_id: 7, bom_version: 2, bom_base_quantity: 1, quantity: 1, quantity_fraction: '', loss_rate: 0, loss_method: 'internal', usage_mode: 'stock' }));
  return { stages: ['1','2'].map((path,index) => ({ path, product_id: 2, unit: 'M', unit_round_up: 0, bom_id: 7, bom_version: 2, base_quantity: 1, loss_method: 'internal',
    planned_quantity: 10, completed_quantity: index ? 2 : 4, available_quantity: index ? 1 : 2, consumed_quantity: index ? 1 : 2, available_cost_cents: index ? 150 : 300,
    items: [{ ...nodes[index], actual_quantity: index ? 2 : 4, standard_quantity: index ? 2 : 4 }],
    pool_usages: [{ path: 'parent', name: '芯线', quantity: index ? 1 : 2 }] })), nodes,
    operation_routes: ['1','2'].map(path => ({ path, route_id: 8, route_version: 1, graph: { nodes: [{ id: 'out' }], edges: [] } })) };
};

test('pool totals combine output, remaining costs and actual usage without counting output twice', () => {
  const order = fixture(), [pool] = pooledProductionStages(order);
  assert.deepEqual(stagePoolPaths(order,'2'), ['1','2']);
  assert.equal(pool.planned_quantity,20);
  assert.equal(pool.completed_quantity,6);
  assert.equal(pool.available_quantity,3);
  assert.equal(pool.consumed_quantity,3);
  assert.equal(pool.available_cost_cents,450);
  assert.equal(pool.items[0].actual_quantity,6);
  assert.equal(pool.items[0].standard_quantity,6);
  assert.equal(pool.pool_usages[0].quantity,3);
  assert.equal(order.stages[0].pool_usages[0].quantity,2);
});

test('pool identity excludes parent demand but includes recipe, route and child supply snapshots', () => {
  for (const [target,key,value] of [
    ['stage','product_id',99],['stage','bom_id',99],['stage','bom_version',99],['stage','unit','kg'],['stage','unit_round_up',1],
    ['route','route_id',99],['route','route_version',99],['route','graph',{ nodes: [{ id: 'other' }], edges: [] }],
    ['node','quantity',2],['node','quantity_fraction','1/3'],['node','loss_rate',1],['node','usage_mode','explode'],['node','supply_fraction','1/2'],
  ]) {
    const order=fixture();
    (target==='stage'?order.stages[1]:target==='route'?order.operation_routes[1]:order.nodes[1])[key]=value;
    assert.equal(productionPools(order).length,2,`${target}.${key}`);
  }
  const order=fixture();order.stages[1].planned_quantity=15;order.stages[1].parent_path='different';
  assert.equal(productionPools(order).length,1);
});
