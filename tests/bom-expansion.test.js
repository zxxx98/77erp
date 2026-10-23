import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBomNodes, calculateBomNodes } from '../shared/bom-expansion.js';
import { parseBomQuantity } from '../shared/bom.js';

const product = id => ({ id, name: `物料${id}`, barcode: `P${id}`, specification: '', unit: '件', active: 1, stock: 0 });
const item = (id, extra = {}) => ({ product_id: id, product: product(id), quantity: 1, quantity_fraction: '', loss_rate: 0, usage_mode: 'stock', child_bom_id: null, unit: '件', note: '', ...extra });
const bom = (id, items, extra = {}) => ({ id, warehouse_id: 1, product_id: id, product: product(id), version: id, name: `配方${id}`, base_quantity: 1, base_unit: '件', loss_method: 'internal', enabled: 1, note: '', scraps: [], items, ...extra });

test('three levels combine each recipe loss method and fraction without rounding intermediate demand', () => {
  const recipes = new Map([
    [1, bom(1, [item(2, { loss_rate: 10, usage_mode: 'explode', child_bom_id: 2 })])],
    [2, bom(2, [item(3, { quantity: 3, loss_rate: 10, usage_mode: 'explode', child_bom_id: 3 })], { loss_method: 'external' })],
    [3, bom(3, [item(4, parseBomQuantity('1/3'))], { base_quantity: 3 })],
  ]);
  const nodes = buildBomNodes(recipes.get(1), id => recipes.get(id));
  const result = calculateBomNodes(nodes, 9);
  assert.deepEqual(result.nodes.map(row => row.required), [10, 33, 3.666667]);
  assert.equal(result.rows[0].required, 3.666667);
  const exact = new Map([[1, bom(1, [item(2, { ...parseBomQuantity('1/3'), usage_mode: 'explode', child_bom_id: 2 })])], [2, bom(2, [item(3, { quantity: 3 })])]]);
  assert.equal(calculateBomNodes(buildBomNodes(exact.get(1), id => exact.get(id)), 1).rows[0].required, 1);
});

test('depth, expanded occurrences, unique leaves and numeric caps fail explicitly instead of truncating', () => {
  const deep = new Map(Array.from({ length: 11 }, (_, i) => [i + 1, bom(i + 1, [item(i + 2, i < 10 ? { usage_mode: 'explode', child_bom_id: i + 2 } : {})])]));
  assert.throws(() => buildBomNodes(deep.get(1), id => deep.get(id)), /10 层/);
  const leaves = Array.from({ length: 100 }, (_, i) => item(i + 1000));
  const child = bom(2, leaves);
  const repeated = bom(1, Array.from({ length: 100 }, (_, i) => item(i + 2, { usage_mode: 'explode', child_bom_id: i + 2 })));
  assert.throws(() => buildBomNodes(repeated, id => ({ ...child, id, product_id: id, product: product(id) })), /2000/);
  const wide = bom(1, Array.from({ length: 6 }, (_, i) => item(i + 2, { usage_mode: 'explode', child_bom_id: i + 2 })));
  assert.throws(() => buildBomNodes(wide, id => bom(id, Array.from({ length: 100 }, (_, j) => item(id * 1000 + j)))), /500/);
  assert.throws(() => calculateBomNodes(buildBomNodes(bom(1, [item(2, { quantity: 99999999 })]), () => null), 2), /上限/);
});
