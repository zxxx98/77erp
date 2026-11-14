import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postProcessingLimit, productionOutputCompleted, postProcessingMaterialAvailableRuns } from '../shared/post-processing.js';

test('post-processing releases whole groups during production and one remainder after output completion', () => {
  for (const [actual, expected] of [[0, 0], [19, 0], [20, 1], [39, 1], [100, 5], [101, 5], [110, 6]]) {
    const order = { planned_quantity: 110, completed_quantity: actual, status: 'in_progress', output_completion_confirmed: false };
    assert.equal(postProcessingLimit(actual, 20, productionOutputCompleted(order)), expected, String(actual));
  }
  assert.equal(postProcessingLimit(0, 20, true), 0);
  assert.equal(postProcessingLimit(39, 20, true), 2);
  assert.equal(productionOutputCompleted({ status: 'void', planned_quantity: 110, completed_quantity: 110, output_completion_confirmed: true }), false);
});

test('post-processing keeps decimal and fractional output boundaries exact', () => {
  assert.equal(postProcessingLimit(0.3, 0.1, false), 3);
  assert.equal(postProcessingLimit('299999999/1000000000', 0.1, false), 2);
  assert.equal(postProcessingLimit('1/3', 0.1, true), 4);
  const order = { status: 'in_progress', planned_quantity: 1, completed_quantity: 1, completed_quantity_fraction: '99999999/100000000' };
  assert.equal(productionOutputCompleted(order), false);
  assert.equal(productionOutputCompleted({ ...order, output_completion_confirmed: true }), true);
});


test('material ratios calculate carton runs exactly without a finished-units coefficient', () => {
  const graph = { nodes: [{ materials: [{ product_id: 1, quantity: 1 }] }],
    post_processing_materials_per_unit: [{ product_id: 1, quantity: 0.01, quantity_fraction: '1/100' }] };
  for (const [output, complete, expected] of [[0, false, 0], [99, false, 0], [100, false, 1], [249, false, 2], [250, true, 3], [1000, true, 10]])
    assert.equal(postProcessingLimit(output, 1, complete, graph), expected);
  graph.post_processing_materials_per_unit[0] = { product_id: 1, quantity: 0.0034, quantity_fraction: '1/300' };
  assert.equal(postProcessingLimit(900, 1, true, graph), 3);
  assert.equal(postProcessingLimit('899999/1000', 1, false, graph), 2);
  assert.equal(postProcessingMaterialAvailableRuns([{ product_id: 1, quantity: 1 }], [{ product_id: 1, available_quantity: 3 }]), 3);
  assert.equal(postProcessingMaterialAvailableRuns([{ product_id: 1, quantity: 1 }], [{ product_id: 1, available_quantity: 0 }]), 0);
});
