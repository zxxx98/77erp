import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationAllocation } from '../shared/operation-overflow.js';

const fixture = () => ({ stage_workflow: 1,
  stages: ['1','2','3'].map(path => ({ path, product_id: 1, bom_id: 2, bom_version: 3, unit: 'M', unit_round_up: 0, planned_quantity: 10 })),
  operation_routes: ['1','2','3'].map(path => ({ path, route_id: 4, route_version: 5, graph: { nodes: ['cut'] },
    operations: [{ id: 'cut', completed_quantity: 8, available_quantity: null }] })),
});

test('overflow uses selected path first, respects predecessor availability and exact decimals', () => {
  const order = fixture();
  order.operation_routes[0].operations[0].available_quantity = 0.1234;
  const parts = operationAllocation(order, '1', 'cut', 3.1234);
  assert.deepEqual(parts.map(p => [p.path,p.quantity]), [['1',0.1234],['2',2],['3',1]]);
  assert.throws(() => operationAllocation(order,'1','cut',5),/剩余可登记数量不足/);
  assert.deepEqual(operationAllocation(order,'2','cut',3).map(p=>[p.path,p.quantity]),[['2',2],['1',0.1234],['3',0.8766]]);
});

test('matching names never permit mixing materials, BOM revisions, routes or units', () => {
  for (const [key,value] of [['product_id',99],['bom_id',99],['bom_version',99],['unit','件'],['unit_round_up',1]]) {
    const order=fixture(); order.stages[1][key]=value;
    assert.deepEqual(operationAllocation(order,'1','cut',3).map(p=>p.path),['1','3']);
  }
  for (const key of ['route_id','route_version']) {
    const order=fixture();order.operation_routes[1][key]=99;
    assert.deepEqual(operationAllocation(order,'1','cut',3).map(p=>p.path),['1','3']);
  }
  const order=fixture();order.operation_routes[1].graph={nodes:['different']};
  assert.deepEqual(operationAllocation(order,'1','cut',3).map(p=>p.path),['1','3']);
});

test('full selected paths can send all quantity to another path and isolated operations retain overproduction', () => {
  const order=fixture();order.operation_routes[0].operations[0].completed_quantity=10;
  assert.deepEqual(operationAllocation(order,'1','cut',1).map(p=>[p.path,p.quantity]),[['2',1]]);
  order.stages=order.stages.slice(0,1);
  assert.equal(operationAllocation(order,'1','cut',20)[0].quantity,20);
  assert.throws(()=>operationAllocation(order,'1','cut',0),/正数/);
  order.stages[0].unit_round_up=1;
  assert.throws(()=>operationAllocation(order,'1','cut',1.5),/取整/);
});
