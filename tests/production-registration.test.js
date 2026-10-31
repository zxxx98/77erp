import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrationTargets, registrationDefaults } from '../src/production-registration.js';

test('operation names expand through route, BOM and layer without mixing identical snapshot nodes', () => {
  const stage = (path, bom_name) => ({ path, name: '同名半成品', unit: '件', bom_name, items: [] });
  const route = (path, route_name, names) => ({ path, route_name, operations: names.map((name, i) => ({ id: `n${i}`, name, is_output: i === names.length - 1 })) });
  const order = { stage_workflow: 1, stages: [stage('', '成品 BOM'), stage('1', '壳体 BOM'), stage('2', '端盖 BOM'), stage('3', '端盖 BOM')],
    operation_routes: [route('', '装配路线', ['装配', '打磨']), route('1', '加工路线', ['打磨']), route('2', '加工路线', ['打磨']), route('3', '加工路线', ['打磨', '打磨'])] };
  const targets = registrationTargets(order);
  assert.equal(new Set(targets.map(row => row.id)).size, 6);
  assert.equal(targets[0].context, '');
  assert.equal(targets[1].context, '装配路线');
  assert.equal(targets[2].context, '加工路线 · 壳体 BOM');
  assert.equal(targets[2].showPath, false);
  assert.equal(targets[3].context, '加工路线 · 端盖 BOM');
  assert.equal(targets[3].showPath, true);
  assert.equal(targets[4].showStep, true);
  assert.equal(targets[5].showStep, true);
  assert.equal(targets[4].output, false);
  assert.equal(targets[5].output, true);

  const branched = registrationTargets({
    stage_workflow: 1,
    stages: [
      { path: '', parent_path: null, name: '电源线', unit: 'PCS', bom_name: '成品 BOM', items: [] },
      { path: '7', parent_path: '', name: '护套线', unit: 'M', bom_name: '1级 BOM', items: [] },
      { path: '7.2', parent_path: '7', name: '黑白成缆', unit: 'M', bom_name: '2级 BOM', items: [] },
      { path: '7.2.1', parent_path: '7.2', name: '芯线 黑色', unit: 'M', bom_name: '黑芯 BOM', items: [] },
      { path: '7.2.1.1', parent_path: '7.2.1', name: '绞合裸铜线*1C', unit: 'M', bom_name: '绞铜 BOM', items: [] },
      { path: '7.2.2', parent_path: '7.2', name: '芯线 白色', unit: 'M', bom_name: '白芯 BOM', items: [] },
      { path: '7.2.2.1', parent_path: '7.2.2', name: '绞合裸铜线*1C', unit: 'M', bom_name: '绞铜 BOM', items: [] },
    ],
    operation_routes: [
      route('7.2.1.1', '103绞铜工艺图', ['铜线绞合（绞铜）']),
      route('7.2.2.1', '103绞铜工艺图', ['铜线绞合（绞铜）']),
    ],
  });
  assert.equal(branched.find(row => row.path === '7.2.1.1').context, '103绞铜工艺图 · 绞铜 BOM · 芯线 黑色');
  assert.equal(branched.find(row => row.path === '7.2.2.1').context, '103绞铜工艺图 · 绞铜 BOM · 芯线 白色');
});

test('layers without routes remain reportable and standard usage respects fractional rounding', () => {
  const item = { path: '1.1', product_id: 3, quantity: 0.3334, quantity_fraction: '1/3', bom_base_quantity: 1, loss_rate: 0, loss_method: 'internal', unit_round_up: 1 };
  const order = { stage_workflow: 1, stages: [{ path: '1', name: '半成品', unit: '件', bom_name: '半成品配方', items: [item] }], scraps: [{ product_id: 9, method: 'output', quantity: 1 }] };
  const [target] = registrationTargets(order);
  assert.equal(target.output, true);
  assert.equal(target.node, null);
  assert.equal(target.name, '半成品');
  const defaults = registrationDefaults(order, target, 4);
  assert.equal(defaults.items[0].path, '1.1');
  assert.equal(defaults.items[0].quantity, '2');
  assert.deepEqual(defaults.scraps, []);
});

test('ordinary final output fills actual inputs and scrap while intermediate operations consume nothing', () => {
  const order = { base_quantity: 1, product_name: '成品', unit: 'kg', bom_name: '配方', loss_method: 'internal',
    items: [{ product_id: 3, base_quantity: 2, loss_rate: 0 }],
    scraps: [{ product_id: 9, method: 'input_ratio', source_product_id: 3, quantity: 10 }],
    operation_routes: [{ path: '', route_name: '加工路线', operations: [{ id: 'a', name: '下料' }, { id: 'b', name: '产出', is_output: true }] }] };
  const [start, output] = registrationTargets(order);
  assert.deepEqual(registrationDefaults(order, start, 4), { items: [], scraps: [] });
  const defaults = registrationDefaults(order, output, 4);
  assert.equal(defaults.items[0].quantity, '8');
  assert.equal(defaults.scraps[0].quantity, '0.8');
  assert.equal(defaults.scraps[0].disposition, 'stock');
});

test('semi defaults use produced balance first, stock for its deficit and zero for unrelated additions', () => {
  const standard={product_id:2,path:'1',parent_path:'',usage_mode:'explode',quantity:2,quantity_fraction:'',bom_base_quantity:1,loss_rate:0,loss_method:'internal',unit_round_up:0,available_quantity:3};
  const stock={...standard,path:'@stock:root:2',usage_mode:'stock',is_supplemental_input:true,quantity:0,available_quantity:20};
  const extra={...stock,product_id:3,path:'@stock:root:3',available_quantity:100};
  const order={stage_workflow:1,stages:[],scraps:[]},target={output:true,path:'',layer:{items:[standard,stock,extra]}};
  assert.deepEqual(registrationDefaults(order,target,5).items.map(i=>[i.path,i.quantity]),[['1','3'],['@stock:root:2','7'],['@stock:root:3','0']]);
  stock.available_quantity=2;
  assert.deepEqual(registrationDefaults(order,target,5).items.map(i=>i.quantity),['8','2','0']);
});
